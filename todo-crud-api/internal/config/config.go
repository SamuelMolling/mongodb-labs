// Package config handles application configuration loading from environment variables.
package config

import (
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds all application configuration
type Config struct {
	Server  ServerConfig
	MongoDB MongoDBConfig
	CORS    CORSConfig
}

// ServerConfig holds HTTP server configuration
type ServerConfig struct {
	Port    string
	GinMode string
}

// MongoDBConfig holds MongoDB configuration
type MongoDBConfig struct {
	URI        string
	Database   string
	Collection string
	Timeout    int
}

// CORSConfig holds CORS configuration
type CORSConfig struct {
	AllowedOrigins []string
}

// Load loads configuration from .env file
func Load() *Config {
	// Load .env file (ignore error if it doesn't exist)
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found, using system environment variables")
	}

	config := &Config{
		Server: ServerConfig{
			Port:    getEnv("PORT", "8080"),
			GinMode: getEnv("GIN_MODE", "debug"),
		},
		MongoDB: MongoDBConfig{
			URI:        getEnv("MONGODB_URI", ""),
			Database:   getEnv("MONGODB_DATABASE", "todoapp"),
			Collection: getEnv("MONGODB_COLLECTION", "tasks"),
			Timeout:    getEnvAsInt("MONGODB_TIMEOUT", 10),
		},
		CORS: CORSConfig{
			AllowedOrigins: getEnvAsSlice("CORS_ALLOWED_ORIGINS", []string{"*"}),
		},
	}

	// Validate required configuration
	if config.MongoDB.URI == "" {
		log.Fatal("MONGODB_URI is required. Please configure it in .env file")
	}

	return config
}

// getEnv gets an environment variable or returns a default value
func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

// getEnvAsInt gets an environment variable as int or returns a default value
func getEnvAsInt(key string, defaultValue int) int {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}

	value, err := strconv.Atoi(valueStr)
	if err != nil {
		log.Printf("Warning: Error converting %s to int, using default value %d", key, defaultValue)
		return defaultValue
	}

	return value
}

// getEnvAsSlice gets an environment variable as slice (comma separated)
func getEnvAsSlice(key string, defaultValue []string) []string {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}

	values := strings.Split(valueStr, ",")
	for i, v := range values {
		values[i] = strings.TrimSpace(v)
	}

	return values
}
