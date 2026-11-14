import { Composition } from "remotion";
import "../fonts";
import { DemoDay } from "./DemoDay";
import { DemoDayHook, HOOK_S } from "./Hook";
import { FPS, TOTAL_S } from "./plan";

export const DemoDayRoot: React.FC = () => (
  <>
    <Composition id="DemoDay" component={DemoDay} durationInFrames={Math.round(TOTAL_S * FPS)} fps={FPS} width={1920} height={1080} />
    <Composition id="DemoDayHook" component={DemoDayHook} durationInFrames={Math.round(HOOK_S * FPS)} fps={FPS} width={1920} height={1080} />
  </>
);
