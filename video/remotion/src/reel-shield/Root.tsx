import { Composition } from "remotion";
import "../fonts";
import { ReelShield } from "./ReelShield";
import { T } from "./theme";

export const ReelShieldRoot: React.FC = () => (
  <Composition id="ReelShield" component={ReelShield} durationInFrames={T.total} fps={30} width={1080} height={1920} />
);
