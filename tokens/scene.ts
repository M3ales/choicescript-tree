import {
    Choice,
    CreateTempVariable,
    CreateVariable, Else, ElseIf, FakeChoice,
    Finish,
    GotoLabel,
    GotoScene, If,
    Label, Option,
    Prose, SelectableIf,
} from "../parser";
import {Token} from "./token";
import {SetCommand} from "./set-variable";

export interface Scene {
    sourceUrl: string;
    name: string;
    content: string;

    prose: Prose[];
    labels: Label[];
    localJumps: GotoLabel[];
    externalJumps: GotoScene[];
    finishes: Finish[];
    createTempVariables: CreateTempVariable[];
    createVariables: CreateVariable[];
    setVariables: SetCommand[];

    choices: Choice[];
    options: Option[];
    fakeChoices: FakeChoice[];

    selectableIfs: SelectableIf[];
    ifs: If[];
    elses: Else[];
    elseIfs: ElseIf[];

    flow: Token[];
}