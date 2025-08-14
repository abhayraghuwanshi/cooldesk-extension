import React from 'react';
import { getDomainFromUrl } from '../utils';

export function AddItem({ item, onAdd }) {
  return (
    <li className="add-item">
      <div className="item-info">
        <img src={`https://www.google.com/s2/favicons?domain=${getDomainFromUrl(item.url)}&sz=32`} alt="" className="favicon" />
        <div className="item-details">
          <div className="item-title">{item.title}</div>
          <div className="item-url">{item.url}</div>
        </div>
      </div>
      <button onClick={() => onAdd(item)} className="add-btn">Add</button>
    </li>
  );
}
