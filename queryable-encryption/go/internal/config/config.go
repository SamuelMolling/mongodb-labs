// Package config handles application configuration loading from environment variables.
package config

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds all application configuration
type Config struct {
	MongoDB      MongoDBConfig
	Encryption   EncryptionConfig
	Server       ServerConfig
	CORS              CORSConfig
	SeedDatabase      bool
	SeedCount         int
	DropCollections   bool
}

// MongoDBConfig contains MongoDB connection settings
type MongoDBConfig struct {
	URI        string
	Database   string
	Collection string
}

// EncryptionConfig contains encryption-related settings
type EncryptionConfig struct {
	KeyVaultDatabase   string
	KeyVaultCollection string
	LocalMasterKeyPath string
	CryptSharedLibPath string
}

// ServerConfig contains server settings
type ServerConfig struct {
	Port    string
	GinMode string
}

// CORSConfig contains CORS settings
type CORSConfig struct {
	AllowedOrigins []string
}

// Load reads configuration from environment variables
func Load() *Config {
	// Load .env file if it exists
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	return &Config{
		MongoDB: MongoDBConfig{
			URI:        getEnv("MONGODB_URI", "mongodb://localhost:27017"),
			Database:   getEnv("MONGODB_DATABASE", "hr_encrypted"),
			Collection: getEnv("MONGODB_COLLECTION", "employees"),
		},
		Encryption: EncryptionConfig{
			KeyVaultDatabase:   getEnv("KEY_VAULT_DATABASE", "encryption"),
			KeyVaultCollection: getEnv("KEY_VAULT_COLLECTION", "__keyVault"),
			LocalMasterKeyPath: getEnv("LOCAL_MASTER_KEY_PATH", "./local_master_key.txt"),
			CryptSharedLibPath: getEnv("CRYPT_SHARED_LIB_PATH", ""),
		},
		Server: ServerConfig{
			Port:    getEnv("SERVER_PORT", "8080"),
			GinMode: getEnv("GIN_MODE", "debug"),
		},
		CORS: CORSConfig{
			AllowedOrigins: getEnvAsSlice("CORS_ALLOWED_ORIGINS", []string{"http://localhost:8080"}, ","),
		},
		SeedDatabase:    getEnvAsBool("SEED_DATABASE", true),
		SeedCount:       getEnvAsInt("SEED_COUNT", 100),
		DropCollections: getEnvAsBool("DROP_COLLECTIONS", false),
	}
}

// getEnv gets an environment variable or returns a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvAsSlice gets an environment variable as a slice
func getEnvAsSlice(key string, defaultValue []string, separator string) []string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return strings.Split(value, separator)
}

// getEnvAsBool gets an environment variable as a boolean
func getEnvAsBool(key string, defaultValue bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return strings.ToLower(value) == "true" || value == "1"
}

// getEnvAsInt gets an environment variable as an integer
func getEnvAsInt(key string, defaultValue int) int {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	var intValue int
	if _, err := fmt.Sscanf(value, "%d", &intValue); err != nil {
		return defaultValue
	}
	return intValue
}

// KeyVaultNamespace returns the full namespace for the key vault
func (c *Config) KeyVaultNamespace() string {
	return c.Encryption.KeyVaultDatabase + "." + c.Encryption.KeyVaultCollection
}
