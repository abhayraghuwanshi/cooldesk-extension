/**
 * Enhanced Error Handling System for Database Operations
 * Provides comprehensive error management, logging, and recovery mechanisms
 */

/**
 * Database-specific error types
 */
export class DatabaseError extends Error {
    constructor(message, operation = null, originalError = null, context = {}) {
        super(message)
        this.name = 'DatabaseError'
        this.operation = operation
        this.originalError = originalError
        this.context = context
        this.timestamp = Date.now()
        this.stack = new Error().stack
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            operation: this.operation,
            context: this.context,
            timestamp: this.timestamp,
            originalError: this.originalError ? {
                name: this.originalError.name,
                message: this.originalError.message,
                code: this.originalError.code
            } : null
        }
    }
}

export class ConnectionError extends DatabaseError {
    constructor(message, originalError = null, context = {}) {
        super(message, 'connection', originalError, context)
        this.name = 'ConnectionError'
    }
}

export class TransactionError extends DatabaseError {
    constructor(message, originalError = null, context = {}) {
        super(message, 'transaction', originalError, context)
        this.name = 'TransactionError'
    }
}

export class ValidationError extends DatabaseError {
    constructor(message, field = null, value = null, context = {}) {
        super(message, 'validation', null, { ...context, field, value })
        this.name = 'ValidationError'
        this.field = field
        this.value = value
    }
}

export class MigrationError extends DatabaseError {
    constructor(message, version = null, originalError = null, context = {}) {
        super(message, 'migration', originalError, { ...context, version })
        this.name = 'MigrationError'
        this.version = version
    }
}

export class QuotaError extends DatabaseError {
    constructor(message, originalError = null, context = {}) {
        super(message, 'quota', originalError, context)
        this.name = 'QuotaError'
    }
}

/**
 * Error severity levels
 */
export const ErrorSeverity = {
    LOW: 'low',       // Non-critical, user can continue
    MEDIUM: 'medium', // Affects functionality but recoverable
    HIGH: 'high',     // Critical error, may cause data loss
    CRITICAL: 'critical' // System failure, requires immediate attention
}

/**
 * Error handling strategies
 */
export const ErrorStrategy = {
    LOG_ONLY: 'log_only',           // Just log the error
    RETRY: 'retry',                 // Attempt to retry the operation
    FALLBACK: 'fallback',           // Use fallback mechanism
    NOTIFY_USER: 'notify_user',     // Show user-friendly error
    RECOVER: 'recover',             // Attempt automatic recovery
    FAIL_FAST: 'fail_fast'          // Immediately throw error
}

/**
 * Global error tracking
 */
class ErrorTracker {
    constructor() {
        this.errors = []
        this.maxErrors = 100
        this.listeners = []
    }

    track(error) {
        this.errors.push({
            ...error.toJSON(),
            id: this.generateErrorId()
        })

        // Keep only recent errors
        if (this.errors.length > this.maxErrors) {
            this.errors = this.errors.slice(-this.maxErrors)
        }

        // Notify listeners
        this.listeners.forEach(listener => {
            try {
                listener(error)
            } catch (listenerError) {
                console.error('[Error Tracker] Listener error:', listenerError)
            }
        })

        // Log to Chrome storage (non-blocking)
        this.persistErrors()
    }

    subscribe(listener) {
        this.listeners.push(listener)
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener)
        }
    }

    getErrors(filter = {}) {
        let filtered = [...this.errors]

        if (filter.operation) {
            filtered = filtered.filter(e => e.operation === filter.operation)
        }

        if (filter.severity) {
            filtered = filtered.filter(e => e.context?.severity === filter.severity)
        }

        if (filter.since) {
            filtered = filtered.filter(e => e.timestamp >= filter.since)
        }

        return filtered.sort((a, b) => b.timestamp - a.timestamp)
    }

    clear() {
        this.errors = []
        this.persistErrors()
    }

    async persistErrors() {
        try {
            const { db_errors = [] } = await chrome.storage.local.get(['db_errors'])
            const merged = [...db_errors, ...this.errors.slice(-50)] // Keep last 50
            const unique = merged.filter((error, index, arr) =>
                arr.findIndex(e => e.id === error.id) === index
            )

            await chrome.storage.local.set({
                db_errors: unique.slice(-100) // Keep last 100 across restarts
            })
        } catch (error) {
            console.warn('[Error Tracker] Failed to persist errors:', error)
        }
    }

    generateErrorId() {
        return `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }
}

const errorTracker = new ErrorTracker()

/**
 * Enhanced error handler with strategy support
 */
export async function handleDatabaseError(error, options = {}) {
    const {
        operation = 'unknown',
        context = {},
        severity = ErrorSeverity.MEDIUM,
        strategy = ErrorStrategy.LOG_ONLY,
        maxRetries = 3,
        retryDelay = 1000,
        fallbackFunction = null,
        userMessage = null
    } = options

    // Create appropriate error type
    let dbError
    if (error instanceof DatabaseError) {
        dbError = error
    } else if (error.name === 'QuotaExceededError') {
        dbError = new QuotaError(
            'Database storage quota exceeded',
            error,
            { ...context, severity }
        )
    } else if (error.name === 'VersionError' || error.name === 'BlockedError') {
        dbError = new ConnectionError(
            'Database connection or version conflict',
            error,
            { ...context, severity }
        )
    } else if (error.name === 'TransactionInactiveError' || error.name === 'ReadOnlyError') {
        dbError = new TransactionError(
            'Database transaction error',
            error,
            { ...context, severity }
        )
    } else {
        dbError = new DatabaseError(
            error.message || 'Unknown database error',
            operation,
            error,
            { ...context, severity }
        )
    }

    // Track the error
    errorTracker.track(dbError)

    // Log the error
    const logLevel = severity === ErrorSeverity.CRITICAL ? 'error' : 'warn'
    console[logLevel](`[DB Error Handler] ${operation}:`, {
        message: dbError.message,
        severity,
        strategy,
        context: dbError.context,
        originalError: error
    })

    // Execute strategy
    try {
        switch (strategy) {
            case ErrorStrategy.LOG_ONLY:
                return { success: false, error: dbError }

            case ErrorStrategy.RETRY:
                return await executeRetryStrategy(operation, dbError, { maxRetries, retryDelay, context })

            case ErrorStrategy.FALLBACK:
                if (fallbackFunction && typeof fallbackFunction === 'function') {
                    const fallbackResult = await fallbackFunction(dbError, context)
                    return { success: true, data: fallbackResult, usedFallback: true }
                }
                return { success: false, error: dbError }

            case ErrorStrategy.NOTIFY_USER:
                await notifyUser(dbError, userMessage)
                return { success: false, error: dbError, userNotified: true }

            case ErrorStrategy.RECOVER:
                return await attemptRecovery(dbError, context)

            case ErrorStrategy.FAIL_FAST:
                throw dbError

            default:
                return { success: false, error: dbError }
        }
    } catch (strategyError) {
        console.error('[DB Error Handler] Strategy execution failed:', strategyError)
        return { success: false, error: dbError, strategyError }
    }
}

/**
 * Retry strategy implementation
 */
async function executeRetryStrategy(operation, error, options) {
    const { maxRetries, retryDelay, context } = options

    console.log(`[DB Error Handler] Retrying operation '${operation}', attempts remaining: ${maxRetries}`)

    if (maxRetries <= 0) {
        return { success: false, error, retriesExhausted: true }
    }

    // Wait before retry with exponential backoff
    const delay = retryDelay * (4 - maxRetries) // Increases delay with each retry
    await new Promise(resolve => setTimeout(resolve, delay))

    try {
        // The retry logic would need to be implemented by the calling function
        // This is a placeholder that indicates retry should be attempted
        return { success: false, error, shouldRetry: true, remainingRetries: maxRetries - 1 }
    } catch (retryError) {
        return await executeRetryStrategy(
            operation,
            retryError,
            { ...options, maxRetries: maxRetries - 1 }
        )
    }
}

/**
 * Recovery attempt for common database issues
 */
async function attemptRecovery(error, context) {
    console.log('[DB Error Handler] Attempting automatic recovery...')

    try {
        if (error instanceof QuotaError) {
            // Attempt to free up space
            const freed = await cleanupOldData()
            if (freed > 0) {
                return {
                    success: true,
                    recovered: true,
                    message: `Freed up space by cleaning ${freed} old records`
                }
            }
        }

        if (error instanceof ConnectionError) {
            // Attempt to reconnect
            await new Promise(resolve => setTimeout(resolve, 2000))
            return {
                success: true,
                recovered: true,
                message: 'Attempted database reconnection'
            }
        }

        return { success: false, error, recoveryFailed: true }
    } catch (recoveryError) {
        console.error('[DB Error Handler] Recovery attempt failed:', recoveryError)
        return { success: false, error, recoveryError }
    }
}

/**
 * User notification for critical errors
 */
async function notifyUser(error, customMessage = null) {
    const message = customMessage || getUserFriendlyMessage(error)

    try {
        // Try to show notification via Chrome API
        if (chrome?.notifications?.create) {
            await chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: 'CoolDesk Database Error',
                message
            })
        } else {
            // Fallback to console for testing
            console.warn('[DB Error Handler] User notification:', message)
        }
    } catch (notificationError) {
        console.error('[DB Error Handler] Failed to notify user:', notificationError)
    }
}

/**
 * Generate user-friendly error messages
 */
function getUserFriendlyMessage(error) {
    if (error instanceof QuotaError) {
        return 'Database storage is full. Please consider clearing old data or increasing browser storage.'
    }

    if (error instanceof ConnectionError) {
        return 'Database connection issue. Please refresh the page and try again.'
    }

    if (error instanceof ValidationError) {
        return 'Invalid data detected. Please check your input and try again.'
    }

    if (error instanceof MigrationError) {
        return 'Database update failed. Please restart the extension.'
    }

    return 'A database error occurred. Please try again or contact support if the problem persists.'
}

/**
 * Clean up old data to free space
 */
async function cleanupOldData() {
    try {
        // This would integrate with the actual cleanup functions
        // For now, return a placeholder
        console.log('[DB Error Handler] Cleanup old data triggered')
        return 0 // Number of records cleaned
    } catch (error) {
        console.error('[DB Error Handler] Cleanup failed:', error)
        return 0
    }
}

/**
 * Wrapper for database operations with automatic error handling
 */
export function withErrorHandling(operation, options = {}) {
    return async function (...args) {
        try {
            const result = await operation.apply(this, args)
            // DEEP DEBUG for listWorkspaces
            if (operation.name === 'listWorkspaces' || operation.name === 'operation') {
                if (Array.isArray(result)) {
                    console.log(`[DB Wrapper] ${operation.name || 'op'} returned ${result.length} items`);
                } else {
                    console.log(`[DB Wrapper] ${operation.name || 'op'} returned non-array:`, result);
                }
            }
            return { success: true, data: result }
        } catch (error) {
            return await handleDatabaseError(error, {
                operation: operation.name || 'database_operation',
                ...options
            })
        }
    }
}

/**
 * Decorator for database methods
 */
export function handleErrors(options = {}) {
    return function (target, propertyName, descriptor) {
        const originalMethod = descriptor.value

        descriptor.value = async function (...args) {
            try {
                const result = await originalMethod.apply(this, args)
                return { success: true, data: result }
            } catch (error) {
                return await handleDatabaseError(error, {
                    operation: propertyName,
                    context: { className: target.constructor.name },
                    ...options
                })
            }
        }

        return descriptor
    }
}

/**
 * Get error statistics and health metrics
 */
export function getErrorStats() {
    const errors = errorTracker.getErrors()
    const now = Date.now()
    const oneHour = 60 * 60 * 1000
    const oneDay = 24 * oneHour

    return {
        total: errors.length,
        lastHour: errors.filter(e => e.timestamp > now - oneHour).length,
        lastDay: errors.filter(e => e.timestamp > now - oneDay).length,
        bySeverity: {
            low: errors.filter(e => e.context?.severity === ErrorSeverity.LOW).length,
            medium: errors.filter(e => e.context?.severity === ErrorSeverity.MEDIUM).length,
            high: errors.filter(e => e.context?.severity === ErrorSeverity.HIGH).length,
            critical: errors.filter(e => e.context?.severity === ErrorSeverity.CRITICAL).length
        },
        byOperation: errors.reduce((acc, error) => {
            const op = error.operation || 'unknown'
            acc[op] = (acc[op] || 0) + 1
            return acc
        }, {}),
        mostRecent: errors.slice(0, 5)
    }
}

/**
 * Subscribe to error events
 */
export function subscribeToErrors(listener) {
    return errorTracker.subscribe(listener)
}

/**
 * Clear all tracked errors
 */
export function clearErrors() {
    errorTracker.clear()
}

/**
 * Export error tracker for advanced usage
 */
export { errorTracker }
