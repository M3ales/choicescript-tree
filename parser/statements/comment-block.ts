import { ChoiceToken, CommentToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface CommentBlock extends Statement {
    kind: "Comment";
    content: CommentToken[];
}
  