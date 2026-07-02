import { IdentifierToken, TextImageToken } from "../../scanner/tokens";
import { ProseValue } from "./prose-value";
import { Statement } from "./statement";

export interface TextImageStatement extends Statement {
  kind: "TextImage";
  token: TextImageToken;
  path: ProseValue;
  alignment: IdentifierToken | undefined;
  altText: ProseValue | undefined;
}
