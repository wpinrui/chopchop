/**
 * Timecode Input Component
 *
 * Displays a timecode that can be clicked to edit.
 * Supports HH:MM:SS:FF format and converts to/from seconds.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './TimecodeInput.css';

interface TimecodeInputProps {
  value: number; // Current time in seconds
  fps: number; // Frames per second for conversion
  onChange: (seconds: number) => void; // Callback when time changes
  max?: number; // Maximum allowed time in seconds
  className?: string;
}

const TimecodeInput: React.FC<TimecodeInputProps> = ({
  value,
  fps,
  onChange,
  max = Infinity,
  className = '',
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Format seconds to HH:MM:SS:FF
  const formatTimecode = useCallback((seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * fps);

    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }, [fps]);

  // Parse timecode string to seconds
  const parseTimecode = useCallback((timecode: string): number | null => {
    // Remove any non-numeric characters except colons
    const cleaned = timecode.replace(/[^0-9:]/g, '');

    // Try different formats
    // HH:MM:SS:FF
    let match = cleaned.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    if (match) {
      const [, hrs, mins, secs, frames] = match;
      return parseInt(hrs) * 3600 + parseInt(mins) * 60 + parseInt(secs) + parseInt(frames) / fps;
    }

    // MM:SS:FF (no hours)
    match = cleaned.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    if (match) {
      const [, mins, secs, frames] = match;
      return parseInt(mins) * 60 + parseInt(secs) + parseInt(frames) / fps;
    }

    // SS:FF (just seconds and frames)
    match = cleaned.match(/^(\d{1,2}):(\d{1,2})$/);
    if (match) {
      const [, secs, frames] = match;
      return parseInt(secs) + parseInt(frames) / fps;
    }

    // Just a number (treat as seconds)
    const num = parseFloat(cleaned);
    if (!isNaN(num)) {
      return num;
    }

    return null;
  }, [fps]);

  // Start editing
  const handleClick = useCallback(() => {
    setEditValue(formatTimecode(value));
    setIsEditing(true);
  }, [value, formatTimecode]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Handle input change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  }, []);

  // Commit the edit
  const commitEdit = useCallback(() => {
    const parsed = parseTimecode(editValue);
    if (parsed !== null) {
      // Clamp to valid range
      const clamped = Math.max(0, Math.min(max, parsed));
      onChange(clamped);
    }
    setIsEditing(false);
  }, [editValue, parseTimecode, max, onChange]);

  // Cancel the edit
  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  // Handle key presses
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }, [commitEdit, cancelEdit]);

  // Handle blur
  const handleBlur = useCallback(() => {
    commitEdit();
  }, [commitEdit]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className={`timecode-input editing ${className}`}
        value={editValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    );
  }

  return (
    <span
      className={`timecode-input ${className}`}
      onClick={handleClick}
      title="Click to edit timecode"
    >
      {formatTimecode(value)}
    </span>
  );
};

export default TimecodeInput;
