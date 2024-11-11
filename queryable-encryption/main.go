package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type EmployeeDocument struct {
	Name      string    `bson:"name"`
	Position  string    `bson:"position"`
	Company   string    `bson:"company"`
	Salary    int       `bson:"salary"`
	Currency  string    `bson:"currency"`
	StartDate time.Time `bson:"startDate"`
}

func loadLocalMasterKey(filename string) string {
	if _, err := os.Stat(filename); os.IsNotExist(err) {
		key := "5MxTVQxEhvN4SC+URUTg5JE5aIRe6lJKX+Iz/05TnSe4xlcDv5nzX8bM043z1VY6v09x20NYhXukk9M+x1uOmOISeUUyhLLYmysuzb26RyraD5L1KV1IaaQI+k9cOMB4"
		err = os.WriteFile(filename, []byte(key), 0644)
		if err != nil {
			log.Fatalf("Unable to create the key file: %v", err)
		}
	}
	key, err := os.ReadFile(filename)
	if err != nil {
		log.Fatalf("Unable to read the key file: %v", err)
	}
	return string(key)
}

func getEncryptedFieldsMap() bson.M {
	return bson.M{
		"fields": []bson.M{
			{
				"keyId":    nil,
				"path":     "name",
				"bsonType": "string",
				"queries": []bson.M{
					{
						"queryType": "equality",
					},
				},
			},
			{
				"keyId":    nil,
				"path":     "salary",
				"bsonType": "int",
				"queries": []bson.M{
					{
						"queryType": "range",
						"min":       0,
						"max":       1000000,
					},
				},
			},
		},
	}
}

func GetAutoEncryptionOptions(keyVaultNamespace string, kmsProviders map[string]map[string]interface{}, cryptSharedLibPath string) *options.AutoEncryptionOptions {
	extraOptions := map[string]interface{}{
		"cryptSharedLibPath": cryptSharedLibPath,
	}
	return options.AutoEncryption().
		SetKeyVaultNamespace(keyVaultNamespace).
		SetKmsProviders(kmsProviders).
		SetExtraOptions(extraOptions)
}

func searchByName(coll *mongo.Collection, name string) {
	filter := bson.D{{Key: "name", Value: name}}
	cursor, err := coll.Find(context.TODO(), filter)
	if err != nil {
		log.Fatalf("Unable to find documents by name: %v", err)
	}
	defer cursor.Close(context.TODO())

	fmt.Printf("Documents with name '%s':\n", name)
	for cursor.Next(context.TODO()) {
		var result EmployeeDocument
		if err := cursor.Decode(&result); err != nil {
			log.Fatalf("Error decoding document: %v", err)
		}
		output, _ := json.MarshalIndent(result, "", "    ")
		fmt.Println(string(output))
	}

	if err := cursor.Err(); err != nil {
		log.Fatalf("Cursor error: %v", err)
	}
}

func searchBySalaryRange(coll *mongo.Collection, minSalary, maxSalary int) {
	filter := bson.D{
		{Key: "salary", Value: bson.D{
			{Key: "$gte", Value: minSalary},
			{Key: "$lte", Value: maxSalary},
		}},
	}
	cursor, err := coll.Find(context.TODO(), filter)
	if err != nil {
		log.Fatalf("Unable to find documents by salary range: %v", err)
	}
	defer cursor.Close(context.TODO())

	fmt.Printf("Documents with salary between %d and %d:\n", minSalary, maxSalary)
	for cursor.Next(context.TODO()) {
		var result EmployeeDocument
		if err := cursor.Decode(&result); err != nil {
			log.Fatalf("Error decoding document: %v", err)
		}
		output, _ := json.MarshalIndent(result, "", "    ")
		fmt.Println(string(output))
	}

	if err := cursor.Err(); err != nil {
		log.Fatalf("Cursor error: %v", err)
	}
}

func main() {
	uri := "mongodb+srv://<user>:<pass>@cluster0.ag6bk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
	keyVaultDatabaseName := "encryption"
	keyVaultCollectionName := "__keyVault"
	keyVaultNamespace := keyVaultDatabaseName + "." + keyVaultCollectionName
	encryptedDatabaseName := "employee_data"
	encryptedCollectionName := "employee_salary"

	localMasterKeyFile := "local_master_key.txt"
	localMasterKey := loadLocalMasterKey(localMasterKeyFile)

	kmsProviders := map[string]map[string]interface{}{
		"local": {"key": localMasterKey},
	}

	autoEncryptionOptions := GetAutoEncryptionOptions(
		keyVaultNamespace,
		kmsProviders,
		"/Users/samuelmolling/Documents/github/mongodb-lab/queryable-encryption/mongo_crypt_shared_v1-macos-arm64-enterprise-8.0.3/lib/mongo_crypt_v1.dylib",
	)

	encryptedClient, err := mongo.Connect(
		context.TODO(),
		options.Client().ApplyURI(uri).SetAutoEncryptionOptions(autoEncryptionOptions),
	)
	if err != nil {
		log.Fatalf("Unable to connect to MongoDB: %v", err)
	}
	defer func() {
		_ = encryptedClient.Disconnect(context.TODO())
	}()

	keyVaultCollection := encryptedClient.Database(keyVaultDatabaseName).Collection(keyVaultCollectionName)
	if err := keyVaultCollection.Drop(context.TODO()); err != nil {
		log.Fatalf("Unable to drop key vault collection: %v", err)
	}
	encryptedCollection := encryptedClient.Database(encryptedDatabaseName).Collection(encryptedCollectionName)
	if err := encryptedCollection.Drop(context.TODO()); err != nil {
		log.Fatalf("Unable to drop encrypted collection: %v", err)
	}

	encryptedFieldsMap := getEncryptedFieldsMap()

	clientEncryptionOpts := options.ClientEncryption().
		SetKmsProviders(kmsProviders).
		SetKeyVaultNamespace(keyVaultNamespace)
	clientEncryption, err := mongo.NewClientEncryption(encryptedClient, clientEncryptionOpts)
	if err != nil {
		log.Fatalf("Unable to create ClientEncryption instance: %v", err)
	}
	defer clientEncryption.Close(context.Background())

	createCollectionOptions := options.CreateCollection().SetEncryptedFields(encryptedFieldsMap)
	_, _, err = clientEncryption.CreateEncryptedCollection(
		context.TODO(),
		encryptedClient.Database(encryptedDatabaseName),
		encryptedCollectionName,
		createCollectionOptions,
		"local",
		map[string]string{},
	)
	if err != nil {
		log.Fatalf("Unable to create encrypted collection: %s", err)
	}
	fmt.Printf("Encrypted collection '%s' created.\n", encryptedCollectionName)

	employees := []EmployeeDocument{
		{"Alice Johnson", "Software Engineer", "MongoDB", 100000, "USD", time.Date(2019, time.March, 5, 0, 0, 0, 0, time.UTC)},
		{"Bob Smith", "Product Manager", "MongoDB", 150000, "USD", time.Date(2018, time.June, 15, 0, 0, 0, 0, time.UTC)},
		{"Charlie Brown", "Data Analyst", "MongoDB", 200000, "USD", time.Date(2020, time.April, 20, 0, 0, 0, 0, time.UTC)},
		{"Diana Prince", "HR Specialist", "MongoDB", 250000, "USD", time.Date(2021, time.December, 3, 0, 0, 0, 0, time.UTC)},
		{"Evan Peters", "Marketing Coordinator", "MongoDB", 80000, "USD", time.Date(2022, time.October, 7, 0, 0, 0, 0, time.UTC)},
	}

	coll := encryptedClient.Database(encryptedDatabaseName).Collection(encryptedCollectionName)
	for _, employee := range employees {
		_, err = coll.InsertOne(context.TODO(), employee)
		if err != nil {
			log.Fatalf("Unable to insert the employee document: %s", err)
		}
		fmt.Printf("Inserted document for %s\n", employee.Name)
	}

	coll = encryptedClient.Database("employee_data").Collection("employee_salary")

	searchByName(coll, "Alice Johnson")
	searchBySalaryRange(coll, 150000, 200000)
}
