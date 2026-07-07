import { Composition } from "remotion";
import { Demo } from "./Demo";
import "./style.css";

export const RemotionRoot = () => {
  return (
    <Composition
      id="Demo"
      component={Demo}
      durationInFrames={390}
      fps={30}
      width={1280}
      height={720}
    />
  );
};
