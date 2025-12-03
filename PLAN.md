# Multitrack Implementation Plan

## Overview

Implement multitrack video and audio support with:
- Default 2 video tracks (V1, V2) and 2 audio tracks (A1, A2)
- Add/delete track functionality via mini-toolbar
- Delete constraints: minimum 1 of each type, track must be empty

## Current State Analysis

### What Already Works
- Timeline supports unlimited tracks (array-based)
- graphBuilder processes all video and audio tracks
- Playback/ProgramMonitor uses `flatMap` to iterate all tracks
- Track headers render in Timeline.tsx

### Current Limitations (Out of Scope for This Task)
- Export concatenates clips rather than layering/mixing (would need overlay/amix filters)
- This is acceptable for v0.2 - true layering is a future enhancement

## Implementation Steps

### 1. Update Default Track Initialization (App.tsx)

**File:** `src/App.tsx` (lines 310-334)

Change from 1 video + 1 audio to 2 of each:

```typescript
// Add default video and audio tracks
dispatch(addTrack({
  id: 'video-2', name: 'V2', type: 'video', clips: [], locked: false, muted: false, visible: true, volume: 1,
}));
dispatch(addTrack({
  id: 'video-1', name: 'V1', type: 'video', clips: [], locked: false, muted: false, visible: true, volume: 1,
}));
dispatch(addTrack({
  id: 'audio-1', name: 'A1', type: 'audio', clips: [], locked: false, muted: false, visible: true, volume: 1,
}));
dispatch(addTrack({
  id: 'audio-2', name: 'A2', type: 'audio', clips: [], locked: false, muted: false, visible: true, volume: 1,
}));
```

**Track Order Convention:**
- Video tracks: Higher number = higher layer (V2 above V1 visually, rendered on top during compositing)
- Audio tracks: A1 first, A2 second (order is less critical for audio)
- In array: V2, V1, A1, A2 (video tracks first, then audio - top to bottom in UI)

### 2. Add Track Management UI (Timeline.tsx)

**File:** `src/components/Timeline/Timeline.tsx`

#### 2a. Add Track Toolbar Component

Add a mini-toolbar at the bottom of track headers section with:
- "+" button for video tracks
- "+" button for audio tracks
- Visual separator between button groups

```tsx
{/* Track management toolbar */}
<div className="track-toolbar">
  <button onClick={handleAddVideoTrack} title="Add Video Track">
    <Plus size={12} /> V
  </button>
  <button onClick={handleAddAudioTrack} title="Add Audio Track">
    <Plus size={12} /> A
  </button>
</div>
```

#### 2b. Add Delete Button to Track Headers

Each track header gets a delete button (X) that:
- Is only visible/enabled when:
  - Track has 0 clips (track.clips.length === 0)
  - There's more than 1 track of that type
- Shows tooltip explaining why disabled if constraints not met

```tsx
<div className="track-header">
  <span className="track-name">{track.name}</span>
  <div className="track-controls">
    <button className="track-toggle" title="Mute">M</button>
    <button className="track-toggle" title="Solo">S</button>
    <button className="track-toggle" title="Lock">L</button>
    {canDeleteTrack(track) && (
      <button
        className="track-delete"
        onClick={() => handleDeleteTrack(track.id)}
        title="Delete Track"
      >
        <X size={12} />
      </button>
    )}
  </div>
</div>
```

#### 2c. Implement Handler Functions

```typescript
// Check if track can be deleted
const canDeleteTrack = useCallback((track: Track): boolean => {
  // Must have no clips
  if (track.clips.length > 0) return false;

  // Must have at least 1 other track of same type
  const sameTypeTracks = tracks.filter(t => t.type === track.type);
  return sameTypeTracks.length > 1;
}, [tracks]);

// Add video track
const handleAddVideoTrack = useCallback(() => {
  const videoTracks = tracks.filter(t => t.type === 'video');
  const newNumber = videoTracks.length + 1;
  const newTrack: Track = {
    id: `video-${Date.now()}`,
    name: `V${newNumber}`,
    type: 'video',
    clips: [],
    locked: false,
    muted: false,
    visible: true,
    volume: 1,
  };
  dispatch(addTrack(newTrack));
}, [tracks, dispatch]);

// Add audio track
const handleAddAudioTrack = useCallback(() => {
  const audioTracks = tracks.filter(t => t.type === 'audio');
  const newNumber = audioTracks.length + 1;
  const newTrack: Track = {
    id: `audio-${Date.now()}`,
    name: `A${newNumber}`,
    type: 'audio',
    clips: [],
    locked: false,
    muted: false,
    visible: true,
    volume: 1,
  };
  dispatch(addTrack(newTrack));
}, [tracks, dispatch]);

// Delete track
const handleDeleteTrack = useCallback((trackId: string) => {
  const track = tracks.find(t => t.id === trackId);
  if (track && canDeleteTrack(track)) {
    dispatch(removeTrack(trackId));
  }
}, [tracks, canDeleteTrack, dispatch]);
```

### 3. Add Track Insertion Logic (timelineSlice.ts)

**File:** `src/store/timelineSlice.ts`

Currently `addTrack` just pushes to the end. We need smarter insertion to maintain order:
- Video tracks should be grouped at the top
- Audio tracks should be grouped at the bottom

```typescript
addTrack: (state, action: PayloadAction<Track>) => {
  const newTrack = action.payload;

  if (newTrack.type === 'video') {
    // Insert at end of video tracks (before first audio track)
    const firstAudioIndex = state.tracks.findIndex(t => t.type === 'audio');
    if (firstAudioIndex === -1) {
      state.tracks.push(newTrack);
    } else {
      state.tracks.splice(firstAudioIndex, 0, newTrack);
    }
  } else {
    // Audio track - push to end
    state.tracks.push(newTrack);
  }
},
```

### 4. Add CSS Styles (Timeline.css)

**File:** `src/components/Timeline/Timeline.css`

```css
/* Track toolbar at bottom of headers */
.track-toolbar {
  display: flex;
  gap: 4px;
  padding: 8px;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
}

.track-toolbar button {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  font-size: 11px;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
}

.track-toolbar button:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

/* Track delete button */
.track-delete {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  border: none;
  border-radius: 2px;
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s, color 0.2s;
}

.track-header:hover .track-delete {
  opacity: 1;
}

.track-delete:hover {
  color: var(--error-red);
  background-color: rgba(255, 100, 100, 0.1);
}
```

### 5. Update Clip Placement for Multitrack (Timeline.tsx)

**File:** `src/components/Timeline/Timeline.tsx` (handleTrackDrop)

When dropping a clip, if dropping on wrong track type, find the first track of correct type:

```typescript
// In handleTrackDrop, when type === 'both':
// Find the first available video and audio tracks
const videoTrack = track.type === 'video'
  ? track
  : tracks.find(t => t.type === 'video');
const audioTrack = track.type === 'audio'
  ? track
  : tracks.find(t => t.type === 'audio');
```

This logic already exists and works correctly for multitrack.

## File Changes Summary

| File | Changes |
|------|---------|
| `src/App.tsx` | Update default tracks: 2 video + 2 audio |
| `src/store/timelineSlice.ts` | Smart track insertion to maintain order |
| `src/components/Timeline/Timeline.tsx` | Add track toolbar, delete buttons, handlers |
| `src/components/Timeline/Timeline.css` | Styles for toolbar and delete button |

## Testing Checklist

- [ ] App starts with 2 video and 2 audio tracks
- [ ] Can add video track (appears after existing video tracks)
- [ ] Can add audio track (appears after existing audio tracks)
- [ ] Can delete empty track (when > 1 of that type)
- [ ] Cannot delete track with clips
- [ ] Cannot delete last video track
- [ ] Cannot delete last audio track
- [ ] Dropping clips works on any track
- [ ] Playback works with clips on multiple tracks
- [ ] Export works with clips on multiple tracks
- [ ] Project save/load preserves track structure

## Future Considerations (Out of Scope)

- **Video layering**: Currently clips across video tracks are concatenated. True compositing requires implementing `overlay` filter in graphBuilder.
- **Audio mixing**: Currently clips across audio tracks are concatenated. True mixing requires implementing `amix` filter in graphBuilder.
- These are significant enhancements for a future version.
