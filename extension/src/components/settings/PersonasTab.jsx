import { faLightbulb, faCode, faPalette, faChartLine, faVideo, faGraduationCap, faGlobe, faArrowRight, faArrowLeft, faPlus, faEdit, faRocket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useState } from 'react';

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
  const [currentStep, setCurrentStep] = useState(1);
  const [customProfession, setCustomProfession] = useState('');
  const [showCustomForm, setShowCustomForm] = useState(false);

  // Map profession input to personas
  const professionOptions = [
    { icon: faCode, title: 'Developer', keywords: ['developer', 'programmer', 'engineer', 'coder', 'software'] },
    { icon: faPalette, title: 'Designer', keywords: ['designer', 'ui', 'ux', 'graphic', 'creative'] },
    { icon: faChartLine, title: 'Marketer', keywords: ['marketing', 'marketer', 'growth', 'digital marketing', 'seo'] },
    { icon: faVideo, title: 'Content Creator', keywords: ['creator', 'youtuber', 'content', 'influencer', 'podcaster'] },
    { icon: faGraduationCap, title: 'Student / Researcher', keywords: ['student', 'researcher', 'academic', 'study'] },
    { icon: faGlobe, title: 'General', keywords: ['general', 'other', 'user', 'personal'] }
  ];

  const handleProfessionSelect = (professionTitle) => {
    const matchedPersona = personas.find(p => p.title === professionTitle);
    if (matchedPersona) {
      handlePersonaSelect(matchedPersona);
      setCurrentStep(2);
    }
  };

  const handleCustomProfession = () => {
    // Create a custom persona based on input
    const customPersona = {
      title: customProfession || 'Custom Profession',
      description: `Workspace collection for ${customProfession}`,
      icon: faGlobe,
      workspaces: [
        {
          name: `${customProfession} - Core Tools`,
          description: `Essential tools for ${customProfession}`,
          urls: []
        },
        {
          name: `${customProfession} - Learning`,
          description: `Educational resources and skill development`,
          urls: []
        },
        {
          name: `${customProfession} - Community`,
          description: `Forums, communities, and networking`,
          urls: []
        }
      ]
    };
    handlePersonaSelect(customPersona);
    setCurrentStep(2);
  };

  const resetToStep1 = () => {
    setCurrentStep(1);
    setSelectedPersona(null);
    setSelectedCategories([]);
    setShowCustomForm(false);
    setCustomProfession('');
  };

  return (
    <div style={{ padding: '16px 0' }}>
      {/* Step Indicator */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '24px',
        padding: '12px 16px',
        background: 'var(--surface-1, rgba(255, 255, 255, 0.05))',
        borderRadius: '12px',
        border: '1px solid var(--border, rgba(255, 255, 255, 0.1))'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: currentStep === 1 ? 'var(--accent-primary, #34C759)' : 'var(--text-secondary, #9ca3af)'
        }}>
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: currentStep === 1 ? 'var(--accent-primary, #34C759)' : 'var(--surface-2, rgba(255, 255, 255, 0.1))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: '600',
            color: currentStep === 1 ? 'white' : 'var(--text-secondary, #9ca3af)'
          }}>1</div>
          <span style={{ fontSize: '14px', fontWeight: '500' }}>Choose Profession</span>
        </div>

        <FontAwesomeIcon icon={faArrowRight} style={{ color: 'var(--text-muted, #6b7280)', fontSize: '12px' }} />

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: currentStep === 2 ? 'var(--accent-primary, #34C759)' : 'var(--text-muted, #6b7280)'
        }}>
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: currentStep === 2 ? 'var(--accent-primary, #34C759)' : 'var(--surface-2, rgba(255, 255, 255, 0.1))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: '600',
            color: currentStep === 2 ? 'white' : 'var(--text-muted, #6b7280)'
          }}>2</div>
          <span style={{ fontSize: '14px', fontWeight: '500' }}>Customize Workspaces</span>
        </div>
      </div>

      {currentStep === 1 ? (
        <div>
          <h4 style={{
            margin: '0 0 8px 0',
            color: 'var(--text-primary, #e5e7eb)',
            fontSize: '18px',
            fontWeight: '600'
          }}>
            What's your profession?
          </h4>
          <p style={{
            margin: '0 0 24px 0',
            color: 'var(--text-secondary, #9ca3af)',
            fontSize: '14px',
            lineHeight: '1.5'
          }}>
            Choose the option that best describes your work to get curated workspace collections.
          </p>

          {/* Profession Options */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
            marginBottom: '24px'
          }}>
            {professionOptions.map(option => (
              <button
                key={option.title}
                onClick={() => handleProfessionSelect(option.title)}
                style={{
                  background: 'var(--surface-1, rgba(255, 255, 255, 0.05))',
                  border: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
                  borderRadius: '12px',
                  padding: '20px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backdropFilter: 'blur(10px)',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px'
                }}
                onMouseEnter={(e) => {
                  e.target.style.borderColor = 'var(--accent-primary, #34C759)';
                  e.target.style.background = 'var(--surface-2, rgba(255, 255, 255, 0.08))';
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 8px 24px rgba(52, 199, 89, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.borderColor = 'var(--border, rgba(255, 255, 255, 0.1))';
                  e.target.style.background = 'var(--surface-1, rgba(255, 255, 255, 0.05))';
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = 'none';
                }}
              >
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  background: 'rgba(var(--accent-primary-rgb, 52, 199, 89), 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <FontAwesomeIcon icon={option.icon} style={{ fontSize: '20px', color: 'var(--accent-primary, #34C759)' }} />
                </div>
                <div>
                  <h5 style={{ margin: '0 0 4px 0', color: 'var(--text-primary, #e5e7eb)', fontSize: '16px', fontWeight: '600' }}>
                    {option.title}
                  </h5>
                  <p style={{ margin: 0, color: 'var(--text-secondary, #9ca3af)', fontSize: '13px', lineHeight: '1.4' }}>
                    {personas.find(p => p.title === option.title)?.description || 'Curated workspace collection'}
                  </p>
                </div>
              </button>
            ))}

            {/* Custom Profession Option */}
            <button
              onClick={() => setShowCustomForm(true)}
              style={{
                background: 'rgba(255, 149, 0, 0.1)',
                border: '1px solid rgba(255, 149, 0, 0.2)',
                borderRadius: '12px',
                padding: '20px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                backdropFilter: 'blur(10px)',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '16px'
              }}
              onMouseEnter={(e) => {
                e.target.style.borderColor = 'var(--accent-secondary, #FF9500)';
                e.target.style.background = 'rgba(255, 149, 0, 0.15)';
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 8px 24px rgba(255, 149, 0, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.target.style.borderColor = 'rgba(255, 149, 0, 0.2)';
                e.target.style.background = 'rgba(255, 149, 0, 0.1)';
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }}
            >
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'rgba(255, 149, 0, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <FontAwesomeIcon icon={faPlus} style={{ fontSize: '20px', color: 'var(--accent-secondary, #FF9500)' }} />
              </div>
              <div>
                <h5 style={{ margin: '0 0 4px 0', color: '#e5e7eb', fontSize: '16px', fontWeight: '600' }}>
                  Other Profession
                </h5>
                <p style={{ margin: 0, color: '#9ca3af', fontSize: '13px', lineHeight: '1.4' }}>
                  Create custom workspaces for your specific role
                </p>
              </div>
            </button>
          </div>

          {/* Custom Profession Form */}
          {showCustomForm && (
            <div style={{
              background: 'rgba(255, 149, 0, 0.05)',
              border: '1px solid rgba(255, 149, 0, 0.2)',
              borderRadius: '12px',
              padding: '20px',
              marginTop: '16px'
            }}>
              <h5 style={{ margin: '0 0 12px 0', color: '#e5e7eb', fontSize: '16px', fontWeight: '600' }}>
                <FontAwesomeIcon icon={faEdit} style={{ color: 'var(--accent-secondary, #FF9500)', marginRight: '8px' }} />
                Tell us about your profession
              </h5>
              <input
                type="text"
                value={customProfession}
                onChange={(e) => setCustomProfession(e.target.value)}
                placeholder="e.g., Data Scientist, Teacher, Consultant..."
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: 'var(--surface-2, rgba(255, 255, 255, 0.1))',
                  border: '1px solid var(--border-secondary, rgba(255, 255, 255, 0.2))',
                  borderRadius: '8px',
                  color: 'var(--text-primary, #e5e7eb)',
                  fontSize: '14px',
                  marginBottom: '16px',
                  outline: 'none'
                }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setShowCustomForm(false)}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--surface-2, rgba(255, 255, 255, 0.1))',
                    border: '1px solid var(--border-secondary, rgba(255, 255, 255, 0.2))',
                    borderRadius: '8px',
                    color: 'var(--text-primary, #e5e7eb)',
                    fontSize: '14px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCustomProfession}
                  disabled={!customProfession.trim()}
                  style={{
                    padding: '8px 16px',
                    background: customProfession.trim() ? 'var(--accent-secondary, #FF9500)' : 'rgba(255, 255, 255, 0.05)',
                    border: 'none',
                    borderRadius: '8px',
                    color: customProfession.trim() ? 'white' : '#9ca3af',
                    fontSize: '14px',
                    cursor: customProfession.trim() ? 'pointer' : 'not-allowed',
                    fontWeight: '500'
                  }}
                >
                  Continue
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Step 2: Customize Workspaces */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px'
          }}>
            <button
              onClick={resetToStep1}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 12px',
                background: 'var(--surface-2, rgba(255, 255, 255, 0.1))',
                border: '1px solid var(--border-secondary, rgba(255, 255, 255, 0.2))',
                color: 'var(--text-primary, #e5e7eb)',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = 'rgba(255, 255, 255, 0.15)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
            >
              <FontAwesomeIcon icon={faArrowLeft} style={{ fontSize: '10px' }} />
              Back
            </button>
            <div>
              <h4 style={{ margin: '0 0 4px 0', color: '#e5e7eb', fontSize: '18px', fontWeight: '600' }}>
                Customize Your Workspaces
              </h4>
              <p style={{ margin: 0, color: '#9ca3af', fontSize: '14px' }}>
                Review and customize the workspaces for <strong style={{ color: 'var(--accent-primary, #34C759)' }}>{selectedPersona?.title}</strong>
              </p>
            </div>
          </div>

          {/* Step 2 Content: Workspace Customization */}
          <div style={{ marginBottom: '20px' }}>
            {selectedCategories.map(category => (
              <div key={category.id} style={{
                background: 'var(--surface-1, rgba(255, 255, 255, 0.05))',
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
                        accentColor: 'var(--accent-primary, #34C759)',
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
                        background: 'var(--surface-2, rgba(255, 255, 255, 0.1))',
                        border: '1px solid var(--border-secondary, rgba(255, 255, 255, 0.2))',
                        borderRadius: '8px',
                        color: 'var(--text-primary, #e5e7eb)',
                        fontSize: '16px',
                        fontWeight: '600',
                        marginBottom: '12px',
                        outline: 'none',
                        transition: 'all 0.2s ease'
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = 'var(--accent-primary, #34C759)';
                        e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                        e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                      }}
                    />
                    <div style={{
                      fontSize: '13px',
                      color: 'var(--text-secondary, #9ca3af)',
                      marginBottom: '10px',
                      lineHeight: '1.4'
                    }}>
                      {category.description}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--text-muted, #6b7280)',
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
                background: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 'rgba(255, 255, 255, 0.05)' : 'var(--accent-primary, #34C759)',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 20px',
                color: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? '#9ca3af' : 'white',
                fontSize: '14px',
                fontWeight: '600',
                cursor: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                opacity: creatingWorkspaces || !selectedCategories.some(c => c.selected) ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
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
              <FontAwesomeIcon icon={faRocket} style={{ fontSize: '12px' }} />
              {creatingWorkspaces ? 'Creating...' : 'Create Workspaces'}
            </button>
          </div>
        </div>
      )}

      {/* Tip Section - Only show on Step 1 */}
      {currentStep === 1 && (
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
          <FontAwesomeIcon icon={faLightbulb} style={{ color: 'var(--accent-primary, #34C759)', marginRight: '8px' }} />
          <strong style={{ color: 'var(--accent-primary, #34C759)' }}>Tip:</strong> Each profession comes with curated workspace collections. You can customize workspace names and choose which ones to create in the next step.
        </div>
      )}
    </div>
  );
};

export default PersonasTab;