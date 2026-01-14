import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React, { useEffect, useState } from 'react';
import { getUIState, saveUIState } from '../db/index.js';

// Individual draggable section wrapper
function SortableSection({ id, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const [isHovered, setIsHovered] = React.useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    position: 'relative',
    marginTop: 'var(--section-spacing)',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >

      {children}
    </div>
  );
}

/**
 * DraggableSections component
 *
 * @param {Array} sections - Array of section objects with { id, component }
 * @param {string} storageKey - Key for localStorage/IndexedDB persistence (default: 'sectionOrder')
 */
export function DraggableSections({ sections: initialSections, storageKey = 'sectionOrder' }) {
  const [sections, setSections] = useState(initialSections);
  const [isLoading, setIsLoading] = useState(true);

  // Configure sensors for drag interactions
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Load saved order on mount
  useEffect(() => {
    const loadOrder = async () => {
      try {
        // Try localStorage first (immediate)
        const localOrder = localStorage.getItem(storageKey);
        if (localOrder) {
          try {
            const orderIds = JSON.parse(localOrder);
            const reordered = reorderSections(initialSections, orderIds);
            setSections(reordered);
          } catch (e) {
            console.warn('[DraggableSections] Failed to parse localStorage order', e);
          }
        }

        // Load from IndexedDB (persistent across sessions)
        const uiState = await getUIState();
        const dbOrder = uiState?.[storageKey];
        if (dbOrder && Array.isArray(dbOrder)) {
          const reordered = reorderSections(initialSections, dbOrder);
          setSections(reordered);
        }
      } catch (e) {
        console.warn('[DraggableSections] Failed to load order', e);
      } finally {
        setIsLoading(false);
      }
    };

    loadOrder();
  }, [storageKey]); // Only run on mount or when storageKey changes

  // Update sections when initialSections changes (but preserve order)
  useEffect(() => {
    setSections(prevSections => {
      // Create a map of current sections by id
      const prevMap = new Map(prevSections.map(s => [s.id, s]));

      // Update existing sections and add new ones
      const updated = initialSections.map(newSection => {
        const existing = prevMap.get(newSection.id);
        return existing ? { ...existing, component: newSection.component } : newSection;
      });

      // Preserve order of existing items, append new items at the end
      const existingIds = new Set(prevSections.map(s => s.id));
      const newItems = updated.filter(s => !existingIds.has(s.id));
      const reordered = [
        ...prevSections.map(s => updated.find(u => u.id === s.id)).filter(Boolean),
        ...newItems
      ];

      return reordered;
    });
  }, [initialSections]);

  // Save order to localStorage and IndexedDB
  const saveOrder = async (newOrder) => {
    try {
      const orderIds = newOrder.map(s => s.id);

      // Save to localStorage (immediate)
      localStorage.setItem(storageKey, JSON.stringify(orderIds));

      // Save to IndexedDB (persistent)
      const uiState = await getUIState();
      await saveUIState({
        ...uiState,
        [storageKey]: orderIds,
      });
    } catch (e) {
      console.warn('[DraggableSections] Failed to save order', e);
    }
  };

  // Handle drag end
  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSections((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);

        const newOrder = arrayMove(items, oldIndex, newIndex);

        // Save the new order
        saveOrder(newOrder);

        return newOrder;
      });
    }
  };

  if (isLoading) {
    return null; // Or return a loading skeleton
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={sections.map(s => s.id)}
        strategy={verticalListSortingStrategy}
      >
        {sections.map((section) => (
          <SortableSection key={section.id} id={section.id}>
            {section.component}
          </SortableSection>
        ))}
      </SortableContext>
    </DndContext>
  );
}

// Helper function to reorder sections based on saved order
function reorderSections(sections, orderIds) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return sections;
  }

  const sectionMap = new Map(sections.map(s => [s.id, s]));
  const reordered = [];

  // Add sections in the saved order
  for (const id of orderIds) {
    const section = sectionMap.get(id);
    if (section) {
      reordered.push(section);
      sectionMap.delete(id);
    }
  }

  // Append any new sections that weren't in the saved order
  for (const section of sectionMap.values()) {
    reordered.push(section);
  }

  return reordered;
}
