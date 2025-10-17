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

// Export all API functions
export {
    // Initialization
    initializeDatabase,
    
    // Workspace operations
    listWorkspaces,
    getWorkspace, 
    saveWorkspace,
    deleteWorkspace,
    
    // Workspace URL operations
    addUrlToWorkspace,
    listWorkspaceUrls,
    
    // Scraped Chats operations
    listScrapedChats,
    getScrapedChat,
    saveScrapedChat,
    deleteScrapedChat,
    deleteScrapedChatsByPlatform,
    
    // Notes operations
    listNotes,
    saveNote,
    deleteNote,
    upsertNote,
    
    // URL Notes operations  
    getUrlNotes,
    saveUrlNote,
    deleteUrlNote,
    
    // Settings operations
    getSettings,
    saveSettings,
    
    // UI State operations
    getUIState,
    saveUIState,
    
    // Activity & Time Tracking operations
    putActivityTimeSeriesEvent,
    putActivityRow,
    getAllActivity,
    cleanupOldTimeSeriesData,
    getTimeSeriesStorageStats,
    
    // Legacy compatibility functions
    listAllUrls,
    getUrlRecord,
    upsertUrl,
    listPings,
    upsertPing,
    deletePing,
    deleteWorkspaceById,
    updateWorkspaceGridType,
    updateItemWorkspace,
    
    // Utility functions
    getDatabaseHealth,
    subscribeWorkspaceChanges,
    subscribePinsChanges,
    subscribeDailyNotesChanges,
    subscribeSettingsChanges,
    closeDatabaseConnection
    
} from './unified-api.js'

// Export error handling utilities
export {
    ErrorSeverity,
    ErrorStrategy,
    handleDatabaseError,
    withErrorHandling,
    getErrorStats,
    subscribeToErrors,
    clearErrors
} from './error-handler.js'

// Export validation utilities
export {
    ValidationError,
    ValidationRules,
    validateData,
    validateAndSanitize,
    batchValidate,
    createCustomValidator
} from './validation.js'

// Export migration utilities (for advanced usage)
export {
    isMigrationNeeded,
    performMigration,
    cleanupLegacyDatabases
} from './migration-manager.js'

// Export database configuration (for advanced usage)
export {
    DB_CONFIG,
    SCHEMAS,
    getUnifiedDB,
    getDatabaseHealth as getInternalHealth
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
        
        // Import the function locally to avoid circular dependencies
        const { initializeDatabase } = await import('./unified-api.js')
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
        // Import needed modules locally
        const { DB_CONFIG, getIndexedDBInstance } = await import('./unified-db.js')
        const { closeDatabaseConnection } = await import('./unified-api.js')
        
        // Close existing connections
        closeDatabaseConnection()
        
        // Delete the unified database
        await new Promise((resolve, reject) => {
            const deleteReq = getIndexedDBInstance().deleteDatabase(DB_CONFIG.NAME)
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