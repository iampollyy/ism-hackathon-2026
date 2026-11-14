import { Composition } from "remotion";
import { ColdOpen } from "./ColdOpen";
import { FPS, TOTAL } from "./timing";
import "./fonts";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition id="ColdOpen" component={ColdOpen} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920} />
  );
};
