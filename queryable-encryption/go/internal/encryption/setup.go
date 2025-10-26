// Package encryption handles MongoDB Queryable Encryption setup and configuration.
package encryption

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"os"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	// LocalMasterKeySize is the size of the local master key in bytes (96 bytes)
	LocalMasterKeySize = 96
)

// EncryptionManager handles encryption setup and key management
type EncryptionManager struct {
	KeyVaultNamespace  string
	LocalMasterKeyPath string
	KmsProviders       map[string]map[string]interface{}
	CryptSharedLibPath string
}

// NewEncryptionManager creates a new encryption manager
func NewEncryptionManager(keyVaultNamespace, localMasterKeyPath, cryptSharedLibPath string) *EncryptionManager {
	localMasterKey := loadOrGenerateLocalMasterKey(localMasterKeyPath)

	kmsProviders := map[string]map[string]interface{}{
		"local": {
			"key": localMasterKey,
		},
	}

	return &EncryptionManager{
		KeyVaultNamespace:  keyVaultNamespace,
		LocalMasterKeyPath: localMasterKeyPath,
		KmsProviders:       kmsProviders,
		CryptSharedLibPath: cryptSharedLibPath,
	}
}

// loadOrGenerateLocalMasterKey loads an existing master key or generates a new one
func loadOrGenerateLocalMasterKey(filename string) string {
	// Check if key file exists
	if _, err := os.Stat(filename); os.IsNotExist(err) {
		log.Println("Local master key not found, generating a new one...")
		key := generateLocalMasterKey()

		// Save the key to file
		if err := os.WriteFile(filename, []byte(key), 0600); err != nil {
			log.Fatalf("Unable to save master key to file: %v", err)
		}
		log.Printf("New master key saved to %s", filename)
		return key
	}

	// Load existing key
	keyBytes, err := os.ReadFile(filename)
	if err != nil {
		log.Fatalf("Unable to read master key file: %v", err)
	}

	log.Println("Loaded existing master key")
	return string(keyBytes)
}

// generateLocalMasterKey generates a new 96-byte base64-encoded master key
func generateLocalMasterKey() string {
	key := make([]byte, LocalMasterKeySize)
	if _, err := rand.Read(key); err != nil {
		log.Fatalf("Unable to generate random key: %v", err)
	}
	return base64.StdEncoding.EncodeToString(key)
}

// GetAutoEncryptionOptions returns the auto-encryption options for the MongoDB client
func (em *EncryptionManager) GetAutoEncryptionOptions() *options.AutoEncryptionOptions {
	autoEncryptionOpts := options.AutoEncryption().
		SetKeyVaultNamespace(em.KeyVaultNamespace).
		SetKmsProviders(em.KmsProviders)

	// Add crypt shared library path if provided
	if em.CryptSharedLibPath != "" {
		extraOptions := map[string]interface{}{
			"cryptSharedLibPath": em.CryptSharedLibPath,
		}
		autoEncryptionOpts.SetExtraOptions(extraOptions)
	}

	return autoEncryptionOpts
}

// GetEncryptedFieldsMap returns the encrypted fields configuration for the employees collection
// This defines which fields are encrypted and what types of queries they support
func GetEncryptedFieldsMap() bson.M {
	return bson.M{
		"fields": []bson.M{
			{
				// Name field - supports equality queries
				// This allows us to search for employees by exact name
				"keyId":    nil, // Auto-generated data encryption key
				"path":     "name",
				"bsonType": "string",
				"queries": []bson.M{
					{
						"queryType": "equality",
					},
				},
			},
			{
				// SSN field - supports equality queries
				// This allows us to search by Social Security Number
				"keyId":    nil,
				"path":     "ssn",
				"bsonType": "string",
				"queries": []bson.M{
					{
						"queryType": "equality",
					},
				},
			},
			{
				// Salary field - supports range queries
				// This allows us to search for employees within a salary range
				"keyId":    nil,
				"path":     "salary",
				"bsonType": "int",
				"queries": []bson.M{
					{
						"queryType": "range",
						"min":       0,
						"max":       10000000, // Max salary: $10M
						"sparsity":  1,
					},
				},
			},
		},
	}
}

// CreateEncryptedCollection creates the encrypted collection with proper configuration
func (em *EncryptionManager) CreateEncryptedCollection(
	ctx context.Context,
	client *mongo.Client,
	database *mongo.Database,
	collectionName string,
) error {
	log.Println("Creating encrypted collection...")

	// Get encrypted fields map
	encryptedFieldsMap := GetEncryptedFieldsMap()

	// Create client encryption
	clientEncryptionOpts := options.ClientEncryption().
		SetKmsProviders(em.KmsProviders).
		SetKeyVaultNamespace(em.KeyVaultNamespace)

	clientEncryption, err := mongo.NewClientEncryption(client, clientEncryptionOpts)
	if err != nil {
		return fmt.Errorf("unable to create client encryption: %w", err)
	}
	defer func() {
		if err := clientEncryption.Close(ctx); err != nil {
			log.Printf("Error closing client encryption: %v", err)
		}
	}()

	// Create the encrypted collection
	createCollectionOpts := options.CreateCollection().
		SetEncryptedFields(encryptedFieldsMap)

	_, _, err = clientEncryption.CreateEncryptedCollection(
		ctx,
		database,
		collectionName,
		createCollectionOpts,
		"local", // KMS provider name
		nil,     // masterKey (not needed for local provider)
	)
	if err != nil {
		return fmt.Errorf("unable to create encrypted collection: %w", err)
	}

	log.Printf("Encrypted collection '%s' created successfully", collectionName)
	return nil
}

// DropCollectionIfExists drops a collection if it exists
func DropCollectionIfExists(ctx context.Context, db *mongo.Database, collectionName string) error {
	collections, err := db.ListCollectionNames(ctx, bson.M{"name": collectionName})
	if err != nil {
		return fmt.Errorf("error listing collections: %w", err)
	}

	if len(collections) > 0 {
		if err := db.Collection(collectionName).Drop(ctx); err != nil {
			return fmt.Errorf("error dropping collection: %w", err)
		}
		log.Printf("Dropped existing collection: %s", collectionName)
	}

	return nil
}
