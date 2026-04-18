import {Composition, Folder} from 'remotion';
import {IntroVideo, type IntroVideoProps} from './IntroVideo';

export const FPS = 30;
// 10 × 4s + 1 × 45s (live demo @ 4.5x) + 1 × 5s (whatsapp proof) = 90s
export const DURATION_IN_FRAMES = 90 * FPS;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Marketing">
        <Composition
          id="IntroCouncil"
          component={IntroVideo}
          width={1920}
          height={1080}
          fps={FPS}
          durationInFrames={DURATION_IN_FRAMES}
          defaultProps={
            {
              projectName: 'Kuuna Support Agents',
              city: 'Vienna',
              teamName: 'Team Kuuna',
            } satisfies IntroVideoProps
          }
        />
      </Folder>
    </>
  );
};
