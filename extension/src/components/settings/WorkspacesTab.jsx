import { faFloppyDisk, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

const WorkspacesTab = ({
  editableWorkspaces,
  handleUpdateWorkspaceField,
  handleSaveWorkspaceRow,
  handleDeleteWorkspace,
  handleOpenCreateWorkspace
}) => {
  console.log('[WorkspacesTab] Rendering with editableWorkspaces:', editableWorkspaces);

  return (
    <div>
      <label>
        <span>Workspaces ({editableWorkspaces?.length || 0})</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {editableWorkspaces?.length === 0 && (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              color: '#9ca3af',
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              No workspaces found. Click "Add Workspace" to create one.
            </div>
          )}
          {editableWorkspaces.map((row) => (
            <div key={row.id} style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '12px 16px'
            }}>
              <input
                style={{
                  flex: 1,
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#e5e7eb',
                  fontSize: '14px',
                  outline: 'none'
                }}
                placeholder="Workspace name"
                value={row.name}
                onChange={(e) => handleUpdateWorkspaceField(row.id, 'name', e.target.value)}
              />
              <input
                style={{
                  flex: 2,
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#e5e7eb',
                  fontSize: 'var(--font-base)',
                  outline: 'none'
                }}
                placeholder="Description"
                value={row.description}
                onChange={(e) => handleUpdateWorkspaceField(row.id, 'description', e.target.value)}
              />
              <button
                className="filter-btn"
                onClick={() => handleSaveWorkspaceRow(row.id)}
                title="Save"
                aria-label="Save workspace"
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: '#34C759',
                  border: 'none',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'translateY(-1px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(52, 199, 89, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = 'none';
                }}
              >
                <FontAwesomeIcon icon={faFloppyDisk} />
              </button>
              <button
                className="filter-btn"
                onClick={() => handleDeleteWorkspace(row.id)}
                title="Delete"
                aria-label="Delete workspace"
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'rgba(255, 59, 48, 0.8)',
                  border: 'none',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'translateY(-1px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(255, 59, 48, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = 'none';
                }}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              className="add-link-btn"
              onClick={handleOpenCreateWorkspace}
              title="Create workspace"
              style={{
                background: '#34C759',
                border: 'none',
                borderRadius: '12px',
                padding: '10px 16px',
                color: 'white',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 8px rgba(52, 199, 89, 0.3)'
              }}
              onMouseEnter={(e) => {
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 4px 12px rgba(52, 199, 89, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 8px rgba(52, 199, 89, 0.3)';
              }}
            >
              Add Workspace
            </button>
          </div>
        </div>
      </label>
    </div>
  );
};

export default WorkspacesTab;