import type { Component } from "solid-js";

type Props = { id: string };

const FontDataList: Component<Props> = (props) => {
  return (
    <datalist id={props.id}>
      <option value="BuiltinSerif" />
      <option value="BuiltinSans" />
      <option value="RIDIBatang" />
      <option value="MaruBuri" />
      <option value="Pretendard JP Variable" />
      <option value="KimjungchulMyungjo" />
      <option value="GyeonggiCheonnyeonBatang" />
    </datalist>
  );
};

export default FontDataList;
