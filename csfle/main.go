package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func connectMongo(uri string) *mongo.Client {
	client, err := mongo.Connect(context.TODO(), options.Client().ApplyURI(uri))
	if err != nil {
		log.Fatalf("Error connecting to MongoDB: %v", err)
	}
	return client
}

func setupKMSProviders(localMasterKey string) map[string]map[string]interface{} {
	return map[string]map[string]interface{}{
		"local": {"key": localMasterKey},
	}
}

func setupClientEncryption(client *mongo.Client, kmsProviders map[string]map[string]interface{}, keyVaultNamespace string) *mongo.ClientEncryption {
	clientEncryptionOpts := options.ClientEncryption().
		SetKmsProviders(kmsProviders).
		SetKeyVaultNamespace(keyVaultNamespace)

	clientEncryption, err := mongo.NewClientEncryption(client, clientEncryptionOpts)
	if err != nil {
		log.Fatalf("Erro ao configurar ClientEncryption: %v", err)
	}
	return clientEncryption
}

func ensureKeyVaultIndex(keyVaultColl *mongo.Collection) {
	indexName := "keyAltNames_1"
	cursor, err := keyVaultColl.Indexes().List(context.TODO())
	if err != nil {
		log.Fatalf("Error listing indexes: %v", err)
	}
	defer cursor.Close(context.TODO())

	exists := false
	for cursor.Next(context.TODO()) {
		var index bson.M
		if err := cursor.Decode(&index); err != nil {
			log.Fatalf("Error decoding index: %v", err)
		}
		if index["name"] == indexName {
			exists = true
			break
		}
	}

	if !exists {
		keyVaultIndex := mongo.IndexModel{
			Keys: bson.D{{Key: "keyAltNames", Value: 1}},
			Options: options.Index().
				SetUnique(true).
				SetPartialFilterExpression(bson.D{
					{Key: "keyAltNames", Value: bson.D{
						{Key: "$exists", Value: true},
					}},
				}),
		}
		_, err = keyVaultColl.Indexes().CreateOne(context.TODO(), keyVaultIndex)
		if err != nil {
			log.Fatalf("Error creating index in key vault: %v", err)
		}
		fmt.Println("Index created in key vault.")
	} else {
		fmt.Println("Index already exists in key vault.")
	}
}

func ensureDataKey(clientEncryption *mongo.ClientEncryption, keyVaultColl *mongo.Collection, keyAltName string) (primitive.Binary, error) {
	var existingKey bson.M
	err := keyVaultColl.FindOne(context.TODO(), bson.M{"keyAltNames": keyAltName}).Decode(&existingKey)
	if err == nil {
		fmt.Println("Data key already exists. Reusing existing key.")
		return existingKey["_id"].(primitive.Binary), nil
	} else if err != mongo.ErrNoDocuments {
		return primitive.Binary{}, err
	}

	fmt.Println("Creating new data key.")
	dataKeyOpts := options.DataKey().SetKeyAltNames([]string{keyAltName})
	dataKeyID, err := clientEncryption.CreateDataKey(context.TODO(), "local", dataKeyOpts)
	if err != nil {
		return primitive.Binary{}, err
	}
	return dataKeyID, nil
}

func encryptSalary(clientEncryption *mongo.ClientEncryption, dataKeyID primitive.Binary, salary float64) primitive.Binary {
	salaryInCents := int64(salary * 100)
	rawValueType, rawValueData, err := bson.MarshalValue(salaryInCents)
	if err != nil {
		log.Fatalf("Error preparing value for encryption: %v", err)
	}
	rawValue := bson.RawValue{Type: rawValueType, Value: rawValueData}

	encryptionOpts := options.Encrypt().
		SetAlgorithm("AEAD_AES_256_CBC_HMAC_SHA_512-Deterministic").
		SetKeyID(dataKeyID)

	encryptedData, err := clientEncryption.Encrypt(context.TODO(), rawValue, encryptionOpts)
	if err != nil {
		log.Fatalf("Error encrypting salary: %v", err)
	}

	return primitive.Binary{Subtype: encryptedData.Subtype, Data: encryptedData.Data}
}

func insertEmployeeDoc(coll *mongo.Collection, name, position, company string, salaryEncrypted primitive.Binary, currency string, startDate time.Time) {
	employeeDoc := bson.D{
		{Key: "name", Value: name},
		{Key: "position", Value: position},
		{Key: "company", Value: company},
		{Key: "salary", Value: salaryEncrypted},
		{Key: "currency", Value: currency},
		{Key: "startDate", Value: startDate},
	}

	_, err := coll.InsertOne(context.TODO(), employeeDoc)
	if err != nil {
		log.Fatalf("Error inserting employee document: %v", err)
	}
}

func findAllAndDecryptSalaries(coll *mongo.Collection, clientEncryption *mongo.ClientEncryption) {
	cursor, err := coll.Find(context.TODO(), bson.D{})
	if err != nil {
		log.Fatalf("Error finding documents: %v", err)
	}
	defer cursor.Close(context.TODO())

	for cursor.Next(context.TODO()) {
		var foundDoc bson.M
		if err := cursor.Decode(&foundDoc); err != nil {
			log.Fatalf("Error decoding document: %v", err)
		}

		decrypted, err := clientEncryption.Decrypt(context.TODO(), foundDoc["salary"].(primitive.Binary))
		if err != nil {
			log.Fatalf("Error decrypting salary: %v", err)
		}

		var decryptedSalary int64
		if err := decrypted.Unmarshal(&decryptedSalary); err != nil {
			log.Fatalf("Error unmarshaling decrypted salary: %v", err)
		}

		salaryInDollars := float64(decryptedSalary) / 100.0

		startDate := foundDoc["startDate"].(primitive.DateTime).Time().Format("2006-01-02")

		fmt.Printf("Employee: %s\n", foundDoc["name"])
		fmt.Printf("Position: %s\n", foundDoc["position"])
		fmt.Printf("Company: %s\n", foundDoc["company"])
		fmt.Printf("Start Date: %s\n", startDate)
		fmt.Printf("Currency: %s\n", foundDoc["currency"])
		fmt.Printf("Decrypted Salary: %.2f USD\n", salaryInDollars)
		fmt.Println("---------------------------------------------------")
	}

	if err := cursor.Err(); err != nil {
		log.Fatalf("Cursor error: %v", err)
	}
}

func findAllWithoutDecryption(coll *mongo.Collection) {
	cursor, err := coll.Find(context.TODO(), bson.D{})
	if err != nil {
		log.Fatalf("Error finding documents: %v", err)
	}
	defer cursor.Close(context.TODO())

	for cursor.Next(context.TODO()) {
		var foundDoc bson.M
		if err := cursor.Decode(&foundDoc); err != nil {
			log.Fatalf("Error decoding document: %v", err)
		}

		startDate := foundDoc["startDate"].(primitive.DateTime).Time().Format("2006-01-02")

		fmt.Printf("Employee: %s\n", foundDoc["name"])
		fmt.Printf("Position: %s\n", foundDoc["position"])
		fmt.Printf("Company: %s\n", foundDoc["company"])
		fmt.Printf("Start Date: %s\n", startDate)
		fmt.Printf("Currency: %s\n", foundDoc["currency"])
		fmt.Printf("Encrypted Salary: %v\n", foundDoc["salary"])
		fmt.Println("---------------------------------------------------")
	}

	if err := cursor.Err(); err != nil {
		log.Fatalf("Cursor error: %v", err)
	}
}

func main() {
	uri := "mongodb+srv://<user>:<pass>@demo1.f7x641l.mongodb.net/?retryWrites=true&w=majority&appName=demo1"
	localMasterKey := "JX4CYNaw0Hu9+r3Yj7mFTWGTzQrznY8NBg1zIF3ew+5gQxk6WlrRz/tJS0n0iUojq7x+zTkQfnzDC4F+PCcUqp7pNMnRCEJxfatgW4LpNXp48QOnW2Ut72eCIpUHPS4S"
	kmsProviders := setupKMSProviders(localMasterKey)
	keyVaultNamespace := "encryption.__keyVault"

	client := connectMongo(uri)
	defer client.Disconnect(context.TODO())

	databaseName := "employee_data"
	collectionName := "employee_salary"
	coll := client.Database(databaseName).Collection(collectionName)
	_ = coll.Drop(context.TODO())
	keyVaultColl := client.Database("encryption").Collection("__keyVault")
	ensureKeyVaultIndex(keyVaultColl)

	clientEncryption := setupClientEncryption(client, kmsProviders, keyVaultNamespace)
	defer clientEncryption.Close(context.TODO())

	dataKeyID, err := ensureDataKey(clientEncryption, keyVaultColl, "go_encryption_example")
	if err != nil {
		log.Fatalf("Error ensuring data key: %v", err)
	}

	employees := []struct {
		Name      string
		Position  string
		Company   string
		Salary    float64
		Currency  string
		StartDate time.Time
	}{
		{"Alice Johnson", "Software Engineer", "MongoDB", 50000, "USD", time.Date(2007, time.February, 3, 0, 0, 0, 0, time.UTC)},
		{"Bob Smith", "Product Manager", "MongoDB", 70000, "USD", time.Date(2009, time.March, 14, 0, 0, 0, 0, time.UTC)},
		{"Charlie Brown", "Data Analyst", "MongoDB", 90000, "USD", time.Date(2011, time.June, 21, 0, 0, 0, 0, time.UTC)},
		{"Diana Prince", "Project Manager", "MongoDB", 110000, "USD", time.Date(2012, time.July, 11, 0, 0, 0, 0, time.UTC)},
		{"Edward Stark", "DevOps Engineer", "MongoDB", 130000, "USD", time.Date(2013, time.August, 9, 0, 0, 0, 0, time.UTC)},
		{"Fiona Gallagher", "HR Specialist", "MongoDB", 150000, "USD", time.Date(2014, time.September, 12, 0, 0, 0, 0, time.UTC)},
		{"George Orwell", "Security Analyst", "MongoDB", 170000, "USD", time.Date(2015, time.October, 22, 0, 0, 0, 0, time.UTC)},
		{"Hannah Montana", "Marketing Coordinator", "MongoDB", 190000, "USD", time.Date(2016, time.November, 19, 0, 0, 0, 0, time.UTC)},
		{"Isaac Newton", "Chief Scientist", "MongoDB", 210000, "USD", time.Date(2016, time.December, 5, 0, 0, 0, 0, time.UTC)},
		{"Julia Roberts", "Finance Manager", "MongoDB", 250000, "USD", time.Date(2008, time.January, 28, 0, 0, 0, 0, time.UTC)},
	}

	for _, emp := range employees {
		encryptedSalary := encryptSalary(clientEncryption, dataKeyID, emp.Salary)
		insertEmployeeDoc(coll, emp.Name, emp.Position, emp.Company, encryptedSalary, emp.Currency, emp.StartDate)
	}

	findAllAndDecryptSalaries(coll, clientEncryption)
	findAllWithoutDecryption(coll)
}
