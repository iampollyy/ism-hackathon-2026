import { Composition } from "remotion";
import { FPS, Linkedin, TOTAL_FRAMES } from "./Linkedin";
import "../fonts";

export const RemotionRoot: React.FC = () => (
  <Composition id="LinkedinFounder" component={Linkedin} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1080} height={1080} />
);
