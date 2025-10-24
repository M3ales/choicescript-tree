import { ProseToken } from "../../scanner/tokens";
import { Statement } from "./statement";

export interface ProseStatement extends Statement {
    content: ProseToken[];
    kind: 'Prose';
}