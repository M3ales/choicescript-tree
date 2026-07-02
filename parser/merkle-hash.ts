import { Statement } from "./statements";
import { FNV_OFFSET, fnvMixStr } from "../utils/fnv";

const FNV_OFFSET_2 = 0x174F3B53;

export class MerkleHasher {
  private h1 = FNV_OFFSET;
  private h2 = FNV_OFFSET_2;

  feed(s: string): this {
    this.h1 = fnvMixStr(this.h1, s);
    this.h2 = fnvMixStr(this.h2, s);
    return this;
  }

  feedChild(child: Statement): this {
    return this.feed(child.statementId);
  }

  feedChildren(children: Statement[]): this {
    for (const child of children) {
      this.feed(child.statementId);
    }
    return this;
  }

  digest(): string {
    return (this.h1 >>> 0).toString(36) + (this.h2 >>> 0).toString(36);
  }
}

export const merkle = (kind: string): MerkleHasher =>
  new MerkleHasher().feed(kind).feed("\0");

export const hashStatement = (stmt: { kind: string; [key: string]: any }): string => {
  const h = merkle(stmt.kind);

  hashOwnContent(h, stmt);
  hashChildBodies(h, stmt);

  return h.digest();
};

const hashOwnContent = (h: MerkleHasher, stmt: any): void => {
  if (stmt.token) {
    if (stmt.token.hash !== undefined) h.feed(`#${stmt.token.hash}`);
    else if (stmt.token.value !== undefined) h.feed(String(stmt.token.value));
    if (stmt.token.lineNumber !== undefined) h.feed(`@${stmt.token.lineNumber}`);
  }

  if (stmt.variable?.value) h.feed(`var:${stmt.variable.value}`);
  if (stmt.label?.value) h.feed(`lbl:${stmt.label.value}`);
  if (stmt.codename?.value) h.feed(`cn:${stmt.codename.value}`);
  if (stmt.identifier?.value) h.feed(`id:${stmt.identifier.value}`);
  if (stmt.identifiers && Array.isArray(stmt.identifiers)) {
    for (const id of stmt.identifiers) {
      if (id?.value) h.feed(`id:${id.value}`);
    }
  }
  if (stmt.storeInto?.value) h.feed(`si:${stmt.storeInto.value}`);
  if (stmt.sceneName) h.feed(`sn:${stmt.sceneName}`);

  if (stmt.expression) hashExpression(h, stmt.expression);
  if (stmt.assignment) hashExpression(h, stmt.assignment);
  if (stmt.selectableIf) hashExpression(h, stmt.selectableIf);
  if (stmt.min) hashExpression(h, stmt.min);
  if (stmt.max) hashExpression(h, stmt.max);

  if (stmt.content !== undefined && typeof stmt.content === "string") {
    h.feed(`c:${stmt.content}`);
  }

  if (stmt.parsedSegments) {
    for (const seg of stmt.parsedSegments) {
      h.feed(seg.kind);
      if (seg.text) h.feed(seg.text);
      if (seg.expression) hashExpression(h, seg.expression);
      if (seg.selector) hashExpression(h, seg.selector);
      if (seg.alternatives) {
        for (const alt of seg.alternatives) {
          if (alt.segments) {
            for (const s of alt.segments) {
              h.feed(s.kind);
              if (s.text) h.feed(s.text);
              if (s.expression) hashExpression(h, s.expression);
            }
          }
        }
      }
    }
  }
};

const hashExpression = (h: MerkleHasher, expr: any): void => {
  if (!expr) return;
  if (expr.kind) h.feed(expr.kind);
  if (expr.token?.value !== undefined) h.feed(String(expr.token.value));
  if (expr.operator?.rawValue) h.feed(expr.operator.rawValue);
  if (expr.value !== undefined && typeof expr.value !== "object") h.feed(String(expr.value));

  if (expr.left) hashExpression(h, expr.left);
  if (expr.right) hashExpression(h, expr.right);
  if (expr.expression) hashExpression(h, expr.expression);
  if (expr.value && typeof expr.value === "object") hashExpression(h, expr.value);
  if (expr.identifier?.value) h.feed(expr.identifier.value);
};

const hashChildBodies = (h: MerkleHasher, stmt: any): void => {
  if (stmt.body && Array.isArray(stmt.body)) h.feedChildren(stmt.body);
  if (stmt.elseIfBranches && Array.isArray(stmt.elseIfBranches)) h.feedChildren(stmt.elseIfBranches);
  if (stmt.elseBranch) h.feedChild(stmt.elseBranch);
  if (stmt.options && Array.isArray(stmt.options)) h.feedChildren(stmt.options);
  if (stmt.declarations && Array.isArray(stmt.declarations)) h.feedChildren(stmt.declarations);
  if (stmt.args && Array.isArray(stmt.args)) {
    for (const arg of stmt.args) {
      if (arg && typeof arg === "object" && arg.kind) hashExpression(h, arg);
    }
  }
};
