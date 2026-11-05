import React from 'react';
import {AbsoluteFill, Composition, interpolate, OffthreadVideo, Sequence, useCurrentFrame} from 'remotion';

const align = {top: 'flex-start', center: 'center', bottom: 'flex-end'};

function MotionTitle({title, fps, scale}) {
  const frame = useCurrentFrame();
  const frames = Math.max(1, Math.round((title.end - title.start) * fps));
  const fade = Math.min(10, Math.floor(frames / 3));
  const alpha = fade ? Math.min(interpolate(frame, [0, fade], [0, 1], {extrapolateRight: 'clamp'}),
    interpolate(frame, [frames - fade, frames], [1, 0], {extrapolateLeft: 'clamp'})) : 1;
  const rise = interpolate(frame, [0, Math.max(1, fade)], [18, 0], {extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{display: 'flex', justifyContent: align[title.position], alignItems: 'center',
    padding: '8%', pointerEvents: 'none'}}>
    <div style={{maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textAlign: 'center',
      fontFamily: 'Arial, sans-serif', fontWeight: 800, fontSize: (title.fontSize ?? 72) * scale,
      lineHeight: 1.1, color: title.color, opacity: alpha, transform: `translateY(${rise}px)`,
      textShadow: '0 3px 18px rgba(0,0,0,0.85)',
      background: title.background ? 'rgba(0,0,0,0.62)' : 'transparent',
      borderRadius: 18, padding: title.background ? '0.18em 0.3em' : 0}}>{title.text}</div>
  </AbsoluteFill>;
}

export function EditorMotion({videoUrl, titles = [], width = 1080, height = 1920, fps = 60}) {
  return <AbsoluteFill style={{backgroundColor: 'black'}}>
    {videoUrl ? <OffthreadVideo src={videoUrl} style={{width, height, objectFit: 'contain'}} /> : null}
    {titles.map((title, index) => <Sequence key={index} from={Math.round(title.start * fps)}
      durationInFrames={Math.max(1, Math.round((title.end - title.start) * fps))}>
      <MotionTitle title={title} fps={fps} scale={width / 1080} />
    </Sequence>)}
  </AbsoluteFill>;
}

export function Root() {
  return <Composition id="GymEdit" component={EditorMotion} width={1080} height={1920}
    fps={60} durationInFrames={60} defaultProps={{videoUrl: '', titles: [], width: 1080, height: 1920, fps: 60}}
    calculateMetadata={({props}) => ({width: props.width, height: props.height, fps: props.fps,
      durationInFrames: props.durationFrames})} />;
}
