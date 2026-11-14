import { Composition } from "remotion";
import { FPS, Hero, TOTAL } from "./Hero";

export const HeroRoot: React.FC = () => (
  <Composition id="Hero" component={Hero} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920} />
);
