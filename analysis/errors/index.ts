import { Statement } from "../../parser/statements";

export type Severity = "Warning" | "Error";

export interface AnalysisError {
    statement: Statement;
    severity: Severity;
    message: string;
    solutionCode: number;
    context: Record<string, any>;
}