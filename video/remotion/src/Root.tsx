import { Composition } from "remotion";
import { CARDS } from "./Cards";
import { ColdOpen } from "./ColdOpen";
import { Pitch, PITCH_FRAMES } from "./Pitch";
import { FPS, TOTAL } from "./timing";
import "./fonts";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="ColdOpen" component={ColdOpen} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920} />
      <Composition id="Pitch" component={Pitch} durationInFrames={PITCH_FRAMES} fps={30} width={1920} height={1080} />
      {/* The submission video's cards (Cards.tsx): wide for YouTube/Devpost, vertical for reels. */}
      {CARDS.map((card) => (
        <Composition key={card.id} id={card.id} component={card.component} durationInFrames={card.frames} fps={FPS} width={1920} height={1080} />
      ))}
      {CARDS.map((card) => (
        <Composition
          key={`${card.id}Vertical`}
          id={`${card.id}Vertical`}
          component={card.component}
          durationInFrames={card.frames}
          fps={FPS}
          width={1080}
          height={1920}
        />
      ))}
    </>
  );
};
