/**
 * Comprehensive Data Validation Framework
 * Ensures data integrity and consistency across all database operations
 */

/**
 * Base validation error class
 */
export class ValidationError extends Error {
    constructor(message, field = null, value = null) {
        super(message)
        this.name = 'ValidationError'
        this.field = field
        this.value = value
        this.timestamp = Date.now()
    }
}

/**
 * Validation rule types
 */
export const ValidationRules = {
    REQUIRED: 'required',
    TYPE: 'type',
    MIN_LENGTH: 'minLength',
    MAX_LENGTH: 'maxLength',
    PATTERN: 'pattern',
    MIN_VALUE: 'minValue',
    MAX_VALUE: 'maxValue',
    ENUM: 'enum',
    ARRAY: 'array',
    OBJECT: 'object',
    CUSTOM: 'custom',
    URL: 'url',
    EMAIL: 'email',
    DATE: 'date'
}

/**
 * Schema definitions for each data type
 */
export const VALIDATION_SCHEMAS = {
    // Workspace validation schema
    workspace: {
        id: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1,
            [ValidationRules.MAX_LENGTH]: 100
        },
        name: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1,
            [ValidationRules.MAX_LENGTH]: 200
        },
        gridType: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.ENUM]: ['ItemGrid', 'ProjectGrid']
        },
        icon: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 100
        },
        createdAt: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        updatedAt: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        description: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 1000
        },
        urls: {
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'object',
                maxItems: 500
            }
        }
    },

    // Workspace URL validation schema
    workspaceUrl: {
        url: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.URL]: true,
            [ValidationRules.MAX_LENGTH]: 2000
        },
        title: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 500
        },
        favicon: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 1000
        },
        workspaceIds: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'string',
                maxItems: 50
            }
        },
        addedAt: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        extra: {
            [ValidationRules.TYPE]: 'object'
        }
    },

    // Note validation schema
    note: {
        id: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1,
            [ValidationRules.MAX_LENGTH]: 100
        },
        // Legacy fields for compatibility
        title: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 300
        },
        content: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 10000000 // 10MB limit (increased for images)
        },
        folder: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 50
        },
        // Current fields used by NotesSection
        text: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 10000000 // 10MB limit (increased for images)
        },
        type: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.ENUM]: ['text', 'voice', 'voice-text', 'richtext']
        },
        status: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.ENUM]: ['todo', 'in-progress', 'done']
        },
        // Voice note specific fields
        audioData: {
            [ValidationRules.TYPE]: 'string' // Base64 encoded audio
        },
        duration: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        hasTranscription: {
            [ValidationRules.TYPE]: 'boolean'
        },
        tags: {
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'string',
                maxItems: 20
            }
        },
        createdAt: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        updatedAt: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        // URL-specific fields for URL notes
        url: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 2000
        },
        urlTitle: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 500
        }
    },

    // URL Note validation schema
    urlNote: {
        id: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1
        },
        url: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.URL]: true,
            [ValidationRules.MAX_LENGTH]: 2000
        },
        // Content/Text fields
        content: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 10000000 // 10MB limit
        },
        text: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 10000000 // 10MB limit
        },
        type: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.ENUM]: ['text', 'voice', 'voice-text', 'screenshot', 'todo', 'highlight']
        },
        completed: {
            [ValidationRules.TYPE]: 'boolean'
        },
        selectedText: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 10000
        },
        description: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 10000
        },
        title: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 300
        },
        createdAt: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        updatedAt: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        tags: {
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'string',
                maxItems: 10
            }
        }
    },

    // Pin validation schema
    pin: {
        id: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1
        },
        url: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.URL]: true,
            [ValidationRules.MAX_LENGTH]: 2000
        },
        title: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 300
        },
        favicon: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 1000
        },
        createdAt: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        }
    },

    // Time tracking validation schema
    timeTracking: {
        url: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.URL]: true,
            [ValidationRules.MAX_LENGTH]: 2000
        },
        sessionId: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1
        },
        timestamp: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        timeSpent: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0,
            [ValidationRules.MAX_VALUE]: 86400000 // 24 hours in ms
        },
        metrics: {
            [ValidationRules.TYPE]: 'object'
        }
    },

    // Activity series validation schema
    activitySeries: {
        id: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1
        },
        url: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 2000
            // Removed strict URL validation to handle edge cases
        },
        timestamp: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        sessionId: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1
        },
        metrics: {
            [ValidationRules.TYPE]: 'object'
        },
        context: {
            [ValidationRules.TYPE]: 'object'
        },
        // Legacy fields for backward compatibility
        time: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        scroll: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        clicks: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        forms: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        updatedAt: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        }
    },

    // Settings validation schema
    settings: {
        id: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1
        },
        geminiApiKey: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 200
        },
        modelName: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 100
        },
        visitCountThreshold: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 1,
            [ValidationRules.MAX_VALUE]: 1000
        },
        historyDays: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MAX_VALUE]: 365
        },
        updatedAt: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        // Fields that may come from sync responses
        success: {
            [ValidationRules.TYPE]: 'boolean'
        },
        data: {
            [ValidationRules.TYPE]: 'object'
        }
    },

    // Scraped chat validation schema
    scrapedChat: {
        chatId: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1,
            [ValidationRules.MAX_LENGTH]: 200
        },
        url: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.URL]: true,
            [ValidationRules.MAX_LENGTH]: 2000
        },
        title: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1,
            [ValidationRules.MAX_LENGTH]: 500
        },
        platform: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            // Allow any platform/domain - scraping works for all URLs, not just AI platforms
            [ValidationRules.MIN_LENGTH]: 1,
            [ValidationRules.MAX_LENGTH]: 200
        },
        scrapedAt: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        // Optional fields that may come from sync
        source: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 100
        },
        messages: {
            [ValidationRules.TYPE]: 'array'
        },
        metadata: {
            [ValidationRules.TYPE]: 'object'
        },
        updatedAt: {
            [ValidationRules.TYPE]: 'number'
        },
        createdAt: {
            [ValidationRules.TYPE]: 'number'
        }
    },

    // Scraped config validation schema
    scrapedConfig: {
        domain: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1,
            [ValidationRules.MAX_LENGTH]: 200
        },
        selector: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1,
            [ValidationRules.MAX_LENGTH]: 2000
        },
        container: {
            [ValidationRules.TYPE]: 'string'
        },
        links: {
            [ValidationRules.TYPE]: 'string'
        },
        full: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 4000
        },
        sample: {
            [ValidationRules.TYPE]: 'object'
        },
        enabled: {
            [ValidationRules.TYPE]: 'boolean'
        },
        source: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.ENUM]: ['manual', 'imported', 'auto', 'native']
        },
        excludedDomains: {
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'string'
            }
        },
        excludedPatterns: {
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'string'
            }
        },
        includedPatterns: {
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'string'
            }
        },
        scrapeLimit: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        titleSource: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.ENUM]: ['auto', 'url', 'selector']
        },
        titleSelector: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 2000
        },
        updatedAt: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        // Added during sync to chrome.storage.local
        savedAt: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        }
    },

    // UI state validation schema
    uiState: {
        id: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1
        },
        selectedTab: {
            [ValidationRules.TYPE]: 'string'
        },
        selectedWorkspace: {
            [ValidationRules.TYPE]: 'string'
        },
        viewMode: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.ENUM]: ['grid', 'list', 'card', 'kanban']
        },
        // Header quick access shortcuts (max 5 URLs)
        headerUrls: {
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'string',
                maxItems: 5
            }
        },
        // Quick URLs for header (alternative naming)
        quickUrls: {
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'string',
                maxItems: 5
            }
        },
        lastActiveTab: {
            [ValidationRules.TYPE]: 'string'
        },
        lastAutoCreateHash: {
            [ValidationRules.TYPE]: 'string'
        },
        categoryLastCheck: {
            [ValidationRules.TYPE]: 'object'
        },
        lastWorkspace: {
            [ValidationRules.TYPE]: 'string'
        },
        autoSync: {
            [ValidationRules.TYPE]: 'boolean'
        },
        success: {
            [ValidationRules.TYPE]: 'boolean'
        },
        // Chat scraping state fields
        timestamp: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        platform: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.ENUM]: ['ChatGPT', 'Claude', 'Gemini']
        },
        updatedAt: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        data: {
            [ValidationRules.TYPE]: 'object'
        }
    },

    // Daily memory validation schema
    dailyMemory: {
        id: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1
        },
        userId: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MIN_LENGTH]: 1
        },
        date: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.PATTERN]: /^\d{4}-\d{2}-\d{2}$/
        },
        sessionIds: {
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'string',
                maxItems: 100
            }
        },
        topUrls: {
            [ValidationRules.TYPE]: 'array',
            [ValidationRules.ARRAY]: {
                itemType: 'object',
                maxItems: 20
            }
        },
        noteCount: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        highlightCount: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        summary: {
            [ValidationRules.TYPE]: 'string',
            [ValidationRules.MAX_LENGTH]: 5000
        },
        createdAt: {
            [ValidationRules.REQUIRED]: true,
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        },
        updatedAt: {
            [ValidationRules.TYPE]: 'number',
            [ValidationRules.MIN_VALUE]: 0
        }
    }
}

/**
 * Validate a single field against its rules
 */
function validateField(fieldName, value, rules, context = {}) {
    const errors = []

    // Required check
    if (rules[ValidationRules.REQUIRED] && (value === undefined || value === null || value === '')) {
        errors.push(new ValidationError(`Field '${fieldName}' is required`, fieldName, value))
        return errors // Don't continue validation if required field is missing
    }

    // Skip other validations if value is not provided and not required
    if (value === undefined || value === null) {
        return errors
    }

    // Type check
    if (rules[ValidationRules.TYPE]) {
        const expectedType = rules[ValidationRules.TYPE]
        const actualType = Array.isArray(value) ? 'array' : typeof value

        if (actualType !== expectedType) {
            errors.push(new ValidationError(
                `Field '${fieldName}' must be of type '${expectedType}', got '${actualType}'`,
                fieldName,
                value
            ))
            return errors // Don't continue if type is wrong
        }
    }

    // String validations
    if (typeof value === 'string') {
        if (rules[ValidationRules.MIN_LENGTH] && value.length < rules[ValidationRules.MIN_LENGTH]) {
            errors.push(new ValidationError(
                `Field '${fieldName}' must be at least ${rules[ValidationRules.MIN_LENGTH]} characters long`,
                fieldName,
                value
            ))
        }

        if (rules[ValidationRules.MAX_LENGTH] && value.length > rules[ValidationRules.MAX_LENGTH]) {
            errors.push(new ValidationError(
                `Field '${fieldName}' must not exceed ${rules[ValidationRules.MAX_LENGTH]} characters`,
                fieldName,
                value
            ))
        }

        if (rules[ValidationRules.PATTERN] && !rules[ValidationRules.PATTERN].test(value)) {
            errors.push(new ValidationError(
                `Field '${fieldName}' does not match required pattern`,
                fieldName,
                value
            ))
        }

        if (rules[ValidationRules.URL] && !isValidUrl(value)) {
            errors.push(new ValidationError(
                `Field '${fieldName}' must be a valid URL`,
                fieldName,
                value
            ))
        }

        if (rules[ValidationRules.EMAIL] && !isValidEmail(value)) {
            errors.push(new ValidationError(
                `Field '${fieldName}' must be a valid email address`,
                fieldName,
                value
            ))
        }
    }

    // Number validations
    if (typeof value === 'number') {
        if (rules[ValidationRules.MIN_VALUE] !== undefined && value < rules[ValidationRules.MIN_VALUE]) {
            errors.push(new ValidationError(
                `Field '${fieldName}' must be at least ${rules[ValidationRules.MIN_VALUE]}`,
                fieldName,
                value
            ))
        }

        if (rules[ValidationRules.MAX_VALUE] !== undefined && value > rules[ValidationRules.MAX_VALUE]) {
            errors.push(new ValidationError(
                `Field '${fieldName}' must not exceed ${rules[ValidationRules.MAX_VALUE]}`,
                fieldName,
                value
            ))
        }
    }

    // Enum validation
    if (rules[ValidationRules.ENUM] && !rules[ValidationRules.ENUM].includes(value)) {
        errors.push(new ValidationError(
            `Field '${fieldName}' must be one of: ${rules[ValidationRules.ENUM].join(', ')}`,
            fieldName,
            value
        ))
    }

    // Array validation
    if (Array.isArray(value) && rules[ValidationRules.ARRAY]) {
        const arrayRules = rules[ValidationRules.ARRAY]

        if (arrayRules.maxItems && value.length > arrayRules.maxItems) {
            errors.push(new ValidationError(
                `Field '${fieldName}' must not contain more than ${arrayRules.maxItems} items`,
                fieldName,
                value
            ))
        }

        if (arrayRules.itemType) {
            value.forEach((item, index) => {
                const itemType = Array.isArray(item) ? 'array' : typeof item
                if (itemType !== arrayRules.itemType) {
                    errors.push(new ValidationError(
                        `Field '${fieldName}[${index}]' must be of type '${arrayRules.itemType}', got '${itemType}'`,
                        `${fieldName}[${index}]`,
                        item
                    ))
                }
            })
        }
    }

    // Custom validation
    if (rules[ValidationRules.CUSTOM] && typeof rules[ValidationRules.CUSTOM] === 'function') {
        try {
            const customResult = rules[ValidationRules.CUSTOM](value, context)
            if (customResult !== true) {
                errors.push(new ValidationError(
                    customResult || `Custom validation failed for field '${fieldName}'`,
                    fieldName,
                    value
                ))
            }
        } catch (error) {
            errors.push(new ValidationError(
                `Custom validation error for field '${fieldName}': ${error.message}`,
                fieldName,
                value
            ))
        }
    }

    return errors
}

/**
 * Validate an object against a schema
 */
export function validateData(data, schemaName, context = {}) {
    const schema = VALIDATION_SCHEMAS[schemaName]
    if (!schema) {
        throw new Error(`Unknown validation schema: ${schemaName}`)
    }

    const errors = []

    // Validate each field in the schema
    for (const [fieldName, rules] of Object.entries(schema)) {
        const fieldErrors = validateField(fieldName, data[fieldName], rules, { ...context, data })
        errors.push(...fieldErrors)
    }

    // Check for unknown fields (optional - can be configured)
    if (context.strict !== false) {
        for (const fieldName of Object.keys(data)) {
            if (!schema[fieldName]) {
                errors.push(new ValidationError(
                    `Unknown field '${fieldName}' in ${schemaName} schema`,
                    fieldName,
                    data[fieldName]
                ))
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        data
    }
}

/**
 * Validate and sanitize data before database operations
 */
export function validateAndSanitize(data, schemaName, options = {}) {
    // Pass strict option to context for validateData
    const context = { ...options.context, strict: options.strict }
    const validation = validateData(data, schemaName, context)

    if (!validation.valid) {
        const errorMessage = `Validation failed for ${schemaName}: ${validation.errors.map(e => e.message).join(', ')
            }`
        throw new ValidationError(errorMessage)
    }

    // Sanitize data
    const sanitized = { ...data }

    // Trim strings
    if (options.trimStrings !== false) {
        Object.keys(sanitized).forEach(key => {
            if (typeof sanitized[key] === 'string') {
                sanitized[key] = sanitized[key].trim()
            }
        })
    }

    // Add timestamps if missing
    const now = Date.now()
    if (schemaName === 'workspace' || schemaName === 'note' || schemaName === 'urlNote' || schemaName === 'pin' || schemaName === 'scrapedConfig' || schemaName === 'dailyMemory') {
        if (!sanitized.createdAt) sanitized.createdAt = now
        if (!sanitized.updatedAt) sanitized.updatedAt = now
    }

    return sanitized
}

/**
 * Batch validate multiple records
 */
export function batchValidate(records, schemaName, options = {}) {
    const results = {
        valid: [],
        invalid: [],
        totalValid: 0,
        totalInvalid: 0
    }

    records.forEach((record, index) => {
        try {
            const sanitized = validateAndSanitize(record, schemaName, options)
            results.valid.push({ index, data: sanitized })
            results.totalValid++
        } catch (error) {
            results.invalid.push({
                index,
                data: record,
                error: error.message,
                validationErrors: error instanceof ValidationError ? [error] : []
            })
            results.totalInvalid++
        }
    })

    return results
}

/**
 * URL validation helper
 */
function isValidUrl(string) {
    try {
        const url = new URL(string)
        return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'chrome-extension:'
    } catch {
        return false
    }
}

/**
 * Email validation helper
 */
function isValidEmail(string) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailPattern.test(string)
}

/**
 * Create a custom validation rule
 */
export function createCustomValidator(name, validatorFunction, errorMessage) {
    return {
        [ValidationRules.CUSTOM]: (value, context) => {
            const isValid = validatorFunction(value, context)
            return isValid === true ? true : (errorMessage || `Custom validation '${name}' failed`)
        }
    }
}

/**
 * Validate database query parameters
 */
export function validateQueryParams(params, allowedParams = []) {
    const errors = []

    if (!params || typeof params !== 'object') {
        return { valid: false, errors: [new ValidationError('Query parameters must be an object')] }
    }

    // Check for unknown parameters
    Object.keys(params).forEach(key => {
        if (!allowedParams.includes(key)) {
            errors.push(new ValidationError(`Unknown query parameter: ${key}`, key, params[key]))
        }
    })

    // Validate parameter types
    if (params.limit !== undefined) {
        if (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 1000) {
            errors.push(new ValidationError('Limit must be an integer between 1 and 1000', 'limit', params.limit))
        }
    }

    if (params.offset !== undefined) {
        if (!Number.isInteger(params.offset) || params.offset < 0) {
            errors.push(new ValidationError('Offset must be a non-negative integer', 'offset', params.offset))
        }
    }

    if (params.startDate !== undefined) {
        if (!Number.isInteger(params.startDate) || params.startDate < 0) {
            errors.push(new ValidationError('Start date must be a valid timestamp', 'startDate', params.startDate))
        }
    }

    if (params.endDate !== undefined) {
        if (!Number.isInteger(params.endDate) || params.endDate < 0) {
            errors.push(new ValidationError('End date must be a valid timestamp', 'endDate', params.endDate))
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        sanitized: { ...params }
    }
}