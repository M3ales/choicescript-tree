import { IdentifierToken, ImageToken, ProseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface ImageStatement extends Statement {
  kind: "Image";
  token: ImageToken;
  path: ProseToken;
  alignment: IdentifierToken | undefined;
  altText: ProseToken | undefined;
}
