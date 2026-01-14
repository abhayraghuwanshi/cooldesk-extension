/**
 * Unified Database System - Main Entry Point
 * 
 * This is the new production-ready database system that replaces all existing database files.
 * 
 * MIGRATION GUIDE:
 * ================
 * 
 * OLD CODE:                           NEW CODE:
 * ---------                           ---------
 * import { listWorkspaces }           import { listWorkspaces } 
 * from './workspace-db.js'           from './db/index.js'
 * 
 * import { saveUrlNote }              import { saveUrlNote }
 * from './url-notes-db.js'           from './db/index.js'
 * 
 * import { getSettings }              import { getSettings }
 * from './db.js'                     from './db/index.js'
 * 
 * All functions maintain the same API but now include:
 * - Automatic data validation
 * - Enhanced error handling with recovery
 * - Unified schema with proper indexing
 * - Automatic migration from legacy databases
 * - Production monitoring and health checks
 */

// Import core functions directly for use in setup functions
import { closeDatabaseConnection, initializeDatabase } from './unified-api.js'
import { DB_CONFIG, getUnifiedDB as getIndexedDBInstance } from './unified-db.js'

// Export all API functions
export {

    // Workspace URL operations
    addUrlToWorkspace, cleanupOldTimeSeriesData, closeDatabaseConnection, deleteNote, deletePing, deleteScrapedChat,
    deleteScrapedChatsByPlatform, deleteUrlNote, deleteWorkspace, deleteWorkspaceById, getAllActivity,
    // Utility functions
    getDatabaseHealth, getScrapedChat,
    // Settings operations
    getSettings, getTimeSeriesDataRange, getTimeSeriesStorageStats,
    // UI State operations
    getUIState,
    // URL Notes operations
    getUrlAnalytics, getUrlNotes, getUrlRecord, getWorkspace, listAllUrlNotes,
    // Initialization
    initializeDatabase,
    // Legacy compatibility functions
    listAllUrls,
    // Notes operations
    listNotes, listPings,
    // Scraped Chats operations
    listScrapedChats,
    // Workspace operations
    listWorkspaces, listWorkspaceUrls, putActivityRow,
    // Activity & Time Tracking operations
    putActivityTimeSeriesEvent, saveNote, saveScrapedChat, saveSettings, saveUIState, saveUrlNote, saveWorkspace, subscribeDailyNotesChanges, subscribePinsChanges, subscribeSettingsChanges, subscribeWorkspaceChanges, updateItemWorkspace, updateWorkspaceGridType, upsertNote, upsertPing, upsertUrl
} from './unified-api.js'

// Export error handling utilities
export {
    clearErrors, ErrorSeverity,
    ErrorStrategy, getErrorStats, handleDatabaseError, subscribeToErrors, withErrorHandling
} from './error-handler.js'

// Export validation utilities
export {
    batchValidate,
    createCustomValidator, validateAndSanitize, validateData, ValidationError,
    ValidationRules
} from './validation.js'

// Export migration utilities (for advanced usage)
export {
    cleanupLegacyDatabases, isMigrationNeeded,
    performMigration
} from './migration-manager.js'

// Export database configuration (for advanced usage)
export {
    DB_CONFIG, getDatabaseHealth as getInternalHealth, getUnifiedDB, SCHEMAS
} from './unified-db.js'

/**
 * Quick setup for new installations
 * 
 * Usage:
 * ------
 * import { setupDatabase } from './db/index.js'
 * 
 * // In your extension's background script or main entry:
 * await setupDatabase()
 */
export async function setupDatabase(options = {}) {
    const {
        autoMigrate = true,
        cleanupLegacy = true,
        enableErrorTracking = true
    } = options

    try {
        console.log('[DB Setup] Initializing unified database system...')

        // Use statically imported function (imported at top of file)
        const result = await initializeDatabase()

        if (result.success) {
            console.log('[DB Setup] ✅ Database system ready')

            if (result.migrated) {
                console.log('[DB Setup] ✅ Legacy data migrated successfully')
            }

            return {
                success: true,
                message: 'Database system initialized successfully',
                migrated: result.migrated
            }
        } else {
            throw new Error('Database initialization failed')
        }

    } catch (error) {
        console.error('[DB Setup] ❌ Database setup failed:', error)
        return {
            success: false,
            error: error.message,
            message: 'Database setup failed. Please check console for details.'
        }
    }
}

/**
 * Development helper: Reset database for testing
 * WARNING: This will delete ALL data!
 */
export async function resetDatabase() {
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'development') {
        throw new Error('resetDatabase can only be used in development')
    }

    try {
        // Use statically imported functions (imported at top of file)

        // Close existing connections
        closeDatabaseConnection()

        // Delete the unified database
        await new Promise((resolve, reject) => {
            const idbInstance = typeof indexedDB !== 'undefined' ? indexedDB : getIndexedDBInstance()
            const deleteReq = idbInstance.deleteDatabase(DB_CONFIG.NAME)
            deleteReq.onsuccess = () => resolve()
            deleteReq.onerror = () => reject(deleteReq.error)
            deleteReq.onblocked = () => {
                console.warn('[DB Reset] Database deletion blocked')
                setTimeout(() => reject(new Error('Deletion blocked')), 5000)
            }
        })

        console.log('[DB Reset] Database reset complete')
        return { success: true }

    } catch (error) {
        console.error('[DB Reset] Reset failed:', error)
        return { success: false, error: error.message }
    }
}

// ===== LEGACY COMPATIBILITY NOTICE =====
//
// Legacy database files have been removed and replaced with the unified system.
// All legacy functions are now provided through the unified API above.
//
// If you encounter import errors, update your imports to use the unified API:
//
// OLD: import { listWorkspaces } from './db/workspace-db.js'
// NEW: import { listWorkspaces } from './db/index.js'
//
// The unified system provides the same API with enhanced features:
// - Automatic data validation and sanitization
// - Comprehensive error handling and recovery
// - Performance optimizations and monitoring
// - Automatic migration from legacy data
//
// Legacy files are backed up in ./legacy-backup/ if needed for reference.