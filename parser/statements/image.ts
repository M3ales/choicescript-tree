import { IdentifierToken, ImageToken } from "../../scanner/tokens";
import { ProseValue } from "./prose-value";
import { Statement } from "./statement";

export interface ImageStatement extends Statement {
  kind: "Image";
  token: ImageToken;
  path: ProseValue;
  alignment: IdentifierToken | undefined;
  altText: ProseValue | undefined;
}
