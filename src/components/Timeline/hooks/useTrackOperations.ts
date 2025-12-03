/**
 * useTrackOperations Hook
 *
 * Manages track CRUD operations and renaming.
 * Single Responsibility: Track management operations only.
 */

import { useState, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { addTrack, removeTrack, updateTrack } from '../../../store/timelineSlice';
import { recordHistoryState } from '../../../store/historySlice';
import type { Track } from '@types';

interface TrackOperationsConfig {
  tracks: Track[];
}

interface TrackRenameState {
  editingTrackId: string | null;
  editingTrackName: string;
}

interface TrackOperations {
  renameState: TrackRenameState;
  handleAddTrack: (type: 'video' | 'audio') => void;
  handleDeleteTrack: (trackId: string) => boolean;
  handleStartRename: (trackId: string) => void;
  handleSaveRename: () => void;
  handleCancelRename: () => void;
  setEditingTrackName: (name: string) => void;
}

export function useTrackOperations({ tracks }: TrackOperationsConfig): TrackOperations {
  const dispatch = useDispatch<AppDispatch>();
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackName, setEditingTrackName] = useState('');

  const handleAddTrack = useCallback((type: 'video' | 'audio') => {
    const existingCount = tracks.filter(t => t.type === type).length;
    const name = type === 'video' ? `Video ${existingCount + 1}` : `Audio ${existingCount + 1}`;

    const newTrack: Track = {
      id: `${type}-${Date.now()}-${Math.random()}`,
      type,
      name,
      clips: [],
      muted: false,
      locked: false,
      visible: true,
      volume: 1,
    };

    dispatch(recordHistoryState('Add Track'));
    dispatch(addTrack(newTrack));
  }, [dispatch, tracks]);

  const handleDeleteTrack = useCallback((trackId: string): boolean => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return false;

    if (track.clips.length > 0) {
      const confirmed = window.confirm(
        `This track contains ${track.clips.length} clip(s). Delete track and all clips?`
      );
      if (!confirmed) return false;
    }

    dispatch(recordHistoryState('Delete Track'));
    dispatch(removeTrack(trackId));
    return true;
  }, [dispatch, tracks]);

  const handleStartRename = useCallback((trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
      setEditingTrackId(trackId);
      setEditingTrackName(track.name);
    }
  }, [tracks]);

  const handleSaveRename = useCallback(() => {
    if (editingTrackId && editingTrackName.trim()) {
      dispatch(updateTrack({
        id: editingTrackId,
        updates: { name: editingTrackName.trim() }
      }));
    }
    setEditingTrackId(null);
    setEditingTrackName('');
  }, [dispatch, editingTrackId, editingTrackName]);

  const handleCancelRename = useCallback(() => {
    setEditingTrackId(null);
    setEditingTrackName('');
  }, []);

  return {
    renameState: { editingTrackId, editingTrackName },
    handleAddTrack,
    handleDeleteTrack,
    handleStartRename,
    handleSaveRename,
    handleCancelRename,
    setEditingTrackName,
  };
}
