# Tiered URL Qualification System

## Goal
Stop adding/removing URLs constantly. Use a draft → active promotion system.

## Architecture

```
Activity (Hot)  →  Draft (Warm)  →  Active (Cold)
   Raw events      Shows interest     Committed to workspace
   48h retention   User can see       Stable, no churn
```

## Status Flow

```
URL visited → Track in activity_series
                    ↓
            Check thresholds (periodic job)
                    ↓
         ┌─────────┴─────────┐
         ↓                   ↓
   Meets DRAFT          Meets ACTIVE
   threshold            threshold
         ↓                   ↓
   Add to workspace     Add to workspace
   status: 'draft'      status: 'active'
```

## Thresholds

| Type | Draft | Active |
|------|-------|--------|
| Browser URL | 2 visits OR 2 min | 4 days OR (4 visits AND 6 min) |
| Desktop App | 3 opens OR 5 min | 10 opens OR 30 min |

## Changes Required

### Phase 1: Schema (Day 1)

**1.1 Extension - unified-db.js**
- Bump `DB_CONFIG.VERSION` to 9
- Add migration to add `status` field to `WORKSPACE_URLS`
- Backfill existing URLs as `status: 'active'`

**1.2 Validation - validation.js**
- Add `status` field to `workspaceUrl` schema
- Enum: `['draft', 'active']`

### Phase 2: Qualification Logic (Day 2)

**2.1 Update urlQualification.js**
```javascript
// Returns: 'none' | 'draft' | 'active'
export async function getUrlQualificationStatus(url, type = 'url') {
  const analytics = await getUrlAnalytics(url);
  if (!analytics) return 'none';

  if (type === 'app') {
    // App thresholds
    if (analytics.totalVisits >= 10 || analytics.totalTime >= 1800000) return 'active';
    if (analytics.totalVisits >= 3 || analytics.totalTime >= 300000) return 'draft';
  } else {
    // URL thresholds
    const days = analytics.dailyStats?.filter(d => d.time > 0).length || 0;
    if (days >= 4 || (analytics.totalVisits >= 4 && analytics.totalTime >= 360000)) return 'active';
    if (analytics.totalVisits >= 2 || analytics.totalTime >= 120000) return 'draft';
  }
  return 'none';
}
```

### Phase 3: Stop Direct Additions (Day 2)

**3.1 realTimeCategorizor.js**
- Remove direct `addUrlToWorkspace` calls
- Only track activity, let promotion job handle additions

**3.2 App.jsx (auto-create)**
- Remove `urlsToAppend` logic
- New workspaces start empty, URLs added via promotion

### Phase 4: Promotion Service (Day 3)

**4.1 Create promotionService.js**
```javascript
export async function runPromotion() {
  // 1. Get all activity from last 7 days
  // 2. For each URL, check qualification status
  // 3. If 'draft' or 'active', ensure URL is in appropriate workspace
  // 4. Update status if changed (draft → active)
}
```

**4.2 Schedule promotion**
- Run on extension startup
- Run every 30 minutes via chrome.alarms
- Run when significant activity detected

### Phase 5: UI Changes (Day 4)

**5.1 Workspace URL list**
- Show active URLs normally
- Show drafts in collapsible "Drafts" section at bottom
- Drafts have subtle styling (opacity, dashed border)

**5.2 User actions**
- "Promote to Active" button on draft URLs
- "Demote to Draft" option on active URLs
- Delete removes from workspace entirely

### Phase 6: Cleanup (Day 5)

**6.1 Remove old code**
- Delete `runWorkspaceCleanup` (no longer needed)
- Remove cleanup settings UI
- Remove auto-cleanup on startup

**6.2 Simplify qualification**
- Remove complex category-specific thresholds
- Use simple universal thresholds

## File Changes Summary

| File | Change |
|------|--------|
| `src/db/unified-db.js` | Add migration v9 |
| `src/db/validation.js` | Add status field |
| `src/utils/urlQualification.js` | New `getUrlQualificationStatus()` |
| `src/utils/promotionService.js` | NEW - promotion job |
| `src/utils/realTimeCategorizor.js` | Remove addUrlToWorkspace |
| `src/App.jsx` | Remove urlsToAppend logic |
| `src/components/workspace/WorkspaceUrls.jsx` | Show drafts section |
| `src/background/background.js` | Schedule promotion job |

## Migration Path

**Existing users:**
1. Migration runs, adds `status` column
2. All existing URLs get `status: 'active'` (grandfathered)
3. New URLs start tracking, go through draft → active flow

**New users:**
1. Fresh install with new schema
2. All URLs must earn their way: none → draft → active
3. Workspaces start empty, fill organically

## Success Criteria

- [ ] No more cleanup cycles (add/remove/add)
- [ ] Workspaces only contain engaged URLs
- [ ] Users can see "upcoming" URLs in drafts
- [ ] Clear promotion path visible to users
- [ ] Apps and URLs handled uniformly

## Rollback Plan

If issues arise:
1. Migration is additive (new column), no data loss
2. Can revert to old behavior by ignoring `status` field
3. Set all URLs to `active` to restore old behavior
