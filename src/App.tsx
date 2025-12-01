/**
 * ChopChop Main App Component
 */

import React from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from './store';
import './App.css';

const App: React.FC = () => {
  const projectName = useSelector((state: RootState) => state.project.name);

  return (
    <div className="app">
      <div className="app-header">
        <div className="app-title">ChopChop</div>
        <div className="project-name">{projectName}</div>
      </div>

      <div className="app-body">
        <div className="panel-container">
          <div className="panel media-bin">
            <div className="panel-header">Media Bin</div>
            <div className="panel-content">
              {/* TODO: Media bin component */}
              <p>Media bin will appear here</p>
            </div>
          </div>

          <div className="panel viewer">
            <div className="panel-header">Program Monitor</div>
            <div className="panel-content viewer-content">
              {/* TODO: Viewer component */}
              <div className="viewer-placeholder">
                <p>Preview monitor</p>
              </div>
            </div>
          </div>
        </div>

        <div className="timeline-container">
          <div className="panel timeline">
            <div className="panel-header">Timeline</div>
            <div className="panel-content">
              {/* TODO: Timeline component */}
              <p>Timeline will appear here</p>
            </div>
          </div>
        </div>
      </div>

      <div className="app-footer">
        <div className="status-bar">
          Ready
        </div>
      </div>
    </div>
  );
};

export default App;
