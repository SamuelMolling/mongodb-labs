package middleware

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// Logger is a custom middleware for request logging
func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Start time
		startTime := time.Now()

		// Process the request
		c.Next()

		// End time
		endTime := time.Now()
		latency := endTime.Sub(startTime)

		// Request information
		statusCode := c.Writer.Status()
		clientIP := c.ClientIP()
		method := c.Request.Method
		path := c.Request.URL.Path
		errorMessage := c.Errors.ByType(gin.ErrorTypePrivate).String()

		// Formatted log
		log.Printf("[%s] %s %s %d %s %s",
			method,
			path,
			clientIP,
			statusCode,
			latency,
			errorMessage,
		)
	}
}

// RequestIDMiddleware adds a unique ID for each request
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Generate a unique ID for the request
		requestID := time.Now().UnixNano()
		c.Set("RequestID", requestID)
		c.Writer.Header().Set("X-Request-ID", string(rune(requestID)))
		c.Next()
	}
}
