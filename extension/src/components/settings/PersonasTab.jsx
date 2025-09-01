import { faLightbulb } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React from 'react';

const PersonasTab = ({
  selectedPersona,
  selectedCategories,
  creatingWorkspaces,
  personas,
  getPersonaUrlCount,
  handlePersonaSelect,
  handleCategoryToggle,
  handleCategoryRename,
  createPersonaWorkspaces,
  setSelectedPersona,
  setSelectedCategories
}) => {
  return (
    <div style={{ padding: '16px 0' }}>
      <h4 style={{
        margin: '0 0 12px 0',
        color: '#e5e7eb',
        fontSize: '16px',
        fontWeight: '500'
      }}>
        Create Workspaces from Persona
      </h4>

      {!selectedPersona ? (
        <div>
          <p style={{
            margin: '0 0 16px 0',
            color: '#9ca3af',
            fontSize: '14px',
            lineHeight: '1.5'
          }}>
            Choose the popular persona from here.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            {personas.map(persona => (
              <div key={persona.title} style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                padding: '16px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                backdropFilter: 'blur(10px)'
              }}
                onMouseEnter={(e) => {
                  e.target.closest('div').style.borderColor = '#34C759';
                  e.target.closest('div').style.background = 'rgba(255, 255, 255, 0.08)';
                  e.target.closest('div').style.transform = 'translateY(-2px)';
                  e.target.closest('div').style.boxShadow = '0 8px 24px rgba(52, 199, 89, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.target.closest('div').style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.target.closest('div').style.background = 'rgba(255, 255, 255, 0.05)';
                  e.target.closest('div').style.transform = 'translateY(0)';
                  e.target.closest('div').style.boxShadow = 'none';
                }}
                onClick={() => handlePersonaSelect(persona)}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  <FontAwesomeIcon icon={persona.icon} style={{ fontSize: '20px', color: '#34C759' }} />
                  <strong style={{ color: '#e5e7eb', fontSize: '14px' }}>{persona.title}</strong>
                </div>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                  <div style={{ marginBottom: '8px', fontSize: '11px', color: '#6b7280' }}>
                    {persona.description}
                  </div>
                  {persona.workspaces.map((workspace, idx) => (
                    <div key={idx} style={{ marginBottom: '4px' }}>
                      <strong style={{ color: '#d1d5db' }}>{workspace.name}</strong> - {workspace.urls.length} URLs
                    </div>
                  ))}
                  <div style={{ marginTop: '8px', fontSize: '11px', color: '#4a90e2', fontWeight: '500' }}>
                    Total: {getPersonaUrlCount(persona)} URLs across {persona.workspaces.length} workspaces
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '16px'
          }}>
            <span style={{ fontSize: '20px' }}>{selectedPersona.emoji}</span>
            <h5 style={{ margin: 0, color: '#e5e7eb' }}>{selectedPersona.title} Workspaces</h5>
            <button
              onClick={() => {
                setSelectedPersona(null);
                setSelectedCategories([]);
              }}
              style={{
                marginLeft: 'auto',
                padding: '8px 12px',
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#e5e7eb',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                e.target.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                e.target.style.transform = 'translateY(0)';
              }}
            >
              ← Back
            </button>
          </div>

          <p style={{
            margin: '0 0 16px 0',
            color: '#9ca3af',
            fontSize: '14px'
          }}>
            Select and customize the workspaces you want to create:
          </p>

          <div style={{ marginBottom: '20px' }}>
            {selectedCategories.map(category => (
              <div key={category.id} style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '16px',
                backdropFilter: 'blur(10px)'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    minWidth: '20px',
                    paddingTop: '2px'
                  }}>
                    <input
                      type="checkbox"
                      checked={category.selected}
                      onChange={() => handleCategoryToggle(category.id)}
                      style={{
                        width: '18px',
                        height: '18px',
                        accentColor: '#4a90e2',
                        cursor: 'pointer'
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <input
                      type="text"
                      value={category.editedName}
                      onChange={(e) => handleCategoryRename(category.id, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '12px 16px',
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '8px',
                        color: '#e5e7eb',
                        fontSize: '16px',
                        fontWeight: '600',
                        marginBottom: '12px',
                        outline: 'none',
                        transition: 'all 0.2s ease'
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = '#34C759';
                        e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                        e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                      }}
                    />
                    <div style={{
                      fontSize: '13px',
                      color: '#9ca3af',
                      marginBottom: '10px',
                      lineHeight: '1.4'
                    }}>
                      {category.description}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: '#6b7280',
                      lineHeight: '1.3'
                    }}>
                      <strong style={{ color: '#9ca3af' }}>{category.urls.length} URLs:</strong> {category.urls.slice(0, 3).map(url => {
                        try { return new URL(url).hostname; } catch { return url; }
                      }).join(', ')}
                      {category.urls.length > 3 && ` + ${category.urls.length - 3} more`}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
              {selectedCategories.filter(c => c.selected).length} of {selectedCategories.length} workspaces selected
            </div>
            <button
              className="add-link-btn"
              onClick={createPersonaWorkspaces}
              disabled={creatingWorkspaces || !selectedCategories.some(c => c.selected)}
              style={{
                background: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 'rgba(255, 255, 255, 0.05)' : '#34C759',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 20px',
                color: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? '#9ca3af' : 'white',
                fontSize: '14px',
                fontWeight: '600',
                cursor: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                opacity: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 0.6 : 1
              }}
              onMouseEnter={(e) => {
                if (!creatingWorkspaces && selectedCategories.some(c => c.selected)) {
                  e.target.style.transform = 'translateY(-1px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(52, 199, 89, 0.4)';
                }
              }}
              onMouseLeave={(e) => {
                if (!creatingWorkspaces && selectedCategories.some(c => c.selected)) {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = 'none';
                }
              }}
            >
              {creatingWorkspaces ? 'Creating...' : 'Create Workspaces'}
            </button>
          </div>
        </div>
      )}

      <div style={{
        padding: '16px',
        background: 'rgba(52, 199, 89, 0.1)',
        border: '1px solid rgba(52, 199, 89, 0.2)',
        borderRadius: '12px',
        fontSize: '13px',
        color: '#9ca3af',
        marginTop: '20px',
        backdropFilter: 'blur(10px)'
      }}>
        <FontAwesomeIcon icon={faLightbulb} style={{ color: '#34C759', marginRight: '8px' }} />
        <strong style={{ color: '#34C759' }}>Tip:</strong> Each workspace will be created with curated URLs relevant to your selected persona. You can customize workspace names before creating them.
      </div>
    </div>
  );
};

export default PersonasTab;