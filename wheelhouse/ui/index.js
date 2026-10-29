const Tt = /* @__PURE__ */ Symbol("uninitialized"), oh = "http://www.w3.org/1999/xhtml", bm = "http://www.w3.org/2000/svg", sh = "@attach", ih = !1;
var Zs = Array.isArray, xm = Array.prototype.indexOf, Ui = Array.prototype.includes, ba = Array.from, ah = Object.defineProperty, Fn = Object.getOwnPropertyDescriptor, lh = Object.getOwnPropertyDescriptors, ch = Object.prototype, ym = Array.prototype, xa = Object.getPrototypeOf, qu = Object.isExtensible;
function is(e) {
  return typeof e == "function";
}
const dt = () => {
};
function _m(e) {
  return e();
}
function pl(e) {
  for (var t = 0; t < e.length; t++)
    e[t]();
}
function uh() {
  var e, t, r = new Promise((n, o) => {
    e = n, t = o;
  });
  return { promise: r, resolve: e, reject: t };
}
function wm(e, t, r = !1) {
  return e === void 0 ? r ? (
    /** @type {() => V} */
    t()
  ) : (
    /** @type {V} */
    t
  ) : e;
}
function fr(e, t) {
  if (Array.isArray(e))
    return e;
  if (t === void 0 || !(Symbol.iterator in e))
    return Array.from(e);
  const r = [];
  for (const n of e)
    if (r.push(n), r.length === t) break;
  return r;
}
const Zt = 2, Do = 4, Us = 8, pc = 1 << 24, Nr = 16, kr = 32, mn = 64, vl = 128, vc = 256, Lr = 512, Rt = 1024, Mt = 2048, wr = 4096, Yt = 8192, Xt = 16384, Qo = 32768, Bi = 1 << 25, bn = 65536, Wi = 1 << 17, km = 1 << 18, es = 1 << 19, dh = 1 << 20, Xr = 1 << 25, Hi = 1 << 21, Oo = 1 << 22, Zn = 1 << 23, Qr = /* @__PURE__ */ Symbol("$state"), fh = /* @__PURE__ */ Symbol("component"), hh = /* @__PURE__ */ Symbol("legacy props"), Sm = /* @__PURE__ */ Symbol(""), ph = /* @__PURE__ */ Symbol("attributes"), gl = /* @__PURE__ */ Symbol("class"), ml = /* @__PURE__ */ Symbol("style"), bl = /* @__PURE__ */ Symbol("text"), Ti = /* @__PURE__ */ Symbol("form reset"), Bs = new class extends Error {
  name = "StaleReactionError";
  message = "The reaction that called `getAbortSignal()` was re-run or destroyed";
}(), gc = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  !!globalThis.document?.contentType && /* @__PURE__ */ globalThis.document.contentType.includes("xml")
);
function $m() {
  console.warn("https://svelte.dev/e/derived_inert");
}
function zm() {
  console.warn("https://svelte.dev/e/select_multiple_invalid_value");
}
function Am() {
  console.warn("https://svelte.dev/e/svelte_boundary_reset_noop");
}
function vh(e) {
  return e === this.v;
}
function gh(e, t) {
  return e != e ? t == t : e !== t || e !== null && typeof e == "object" || typeof e == "function";
}
function mh(e) {
  return !gh(e, this.v);
}
function bh(e) {
  throw new Error("https://svelte.dev/e/lifecycle_outside_component");
}
function Em() {
  throw new Error("https://svelte.dev/e/async_derived_orphan");
}
function Mm(e, t, r) {
  throw new Error("https://svelte.dev/e/each_key_duplicate");
}
function Tm(e) {
  throw new Error("https://svelte.dev/e/effect_in_teardown");
}
function Cm() {
  throw new Error("https://svelte.dev/e/effect_in_unowned_derived");
}
function Om(e) {
  throw new Error("https://svelte.dev/e/effect_orphan");
}
function Nm() {
  throw new Error("https://svelte.dev/e/effect_update_depth_exceeded");
}
function Pm(e) {
  throw new Error("https://svelte.dev/e/props_invalid_value");
}
function Im() {
  throw new Error("https://svelte.dev/e/state_descriptors_fixed");
}
function Rm() {
  throw new Error("https://svelte.dev/e/state_prototype_fixed");
}
function Dm() {
  throw new Error("https://svelte.dev/e/state_unsafe_mutation");
}
function Lm() {
  throw new Error("https://svelte.dev/e/svelte_boundary_reset_onerror");
}
let ts = !1, jm = !1;
function Vm() {
  ts = !0;
}
const Fm = [];
function Zm(e, t = !1, r = !1) {
  return Ci(e, /* @__PURE__ */ new Map(), "", Fm, null, r);
}
function Ci(e, t, r, n, o = null, s = !1) {
  if (typeof e == "object" && e !== null) {
    var i = t.get(e);
    if (i !== void 0) return i;
    if (e instanceof Map) return (
      /** @type {Snapshot<T>} */
      new Map(e)
    );
    if (e instanceof Set) return (
      /** @type {Snapshot<T>} */
      new Set(e)
    );
    if (Zs(e)) {
      var l = (
        /** @type {Snapshot<any>} */
        Array(e.length)
      );
      t.set(e, l), o !== null && t.set(o, l);
      for (var c = 0; c < e.length; c += 1) {
        var u = e[c];
        c in e && (l[c] = Ci(u, t, r, n, null, s));
      }
      return l;
    }
    if (xa(e) === ch) {
      l = {}, t.set(e, l), o !== null && t.set(o, l);
      for (var d of Object.keys(e))
        l[d] = Ci(
          // @ts-expect-error
          e[d],
          t,
          r,
          n,
          null,
          s
        );
      return l;
    }
    if (e instanceof Date)
      return e.getTime(), /** @type {Snapshot<T>} */
      structuredClone(e);
    if (typeof /** @type {T & { toJSON?: any } } */
    e.toJSON == "function" && !s)
      return Ci(
        /** @type {T & { toJSON(): any } } */
        e.toJSON(),
        t,
        r,
        n,
        // Associate the instance with the toJSON clone
        e
      );
  }
  if (e instanceof EventTarget)
    return (
      /** @type {Snapshot<T>} */
      e
    );
  try {
    return (
      /** @type {Snapshot<T>} */
      structuredClone(e)
    );
  } catch {
    return (
      /** @type {Snapshot<T>} */
      e
    );
  }
}
function Um(e) {
  let t = e.p;
  for (; t !== null && t.c === null; )
    t = t.p;
  return t?.c ?? null;
}
function mc(e, t) {
  return e === null && bh(), e.c ??= new Map(Um(e) || void 0);
}
let yt = null;
function Lo(e) {
  yt = e;
}
function go(e) {
  return (
    /** @type {T} */
    mc(yt).get(e)
  );
}
function Ws(e, t) {
  return mc(yt).set(e, t), t;
}
function Bm(e) {
  return mc(yt).has(e);
}
function Ee(e, t = !1, r) {
  yt = {
    p: yt,
    i: !1,
    c: null,
    e: null,
    s: e,
    x: null,
    r: (
      /** @type {Effect} */
      ot
    ),
    l: ts && !t ? { s: null, u: null, $: [] } : null
  };
}
function Me(e) {
  var t = (
    /** @type {ComponentContext} */
    yt
  ), r = t.e;
  if (r !== null) {
    t.e = null;
    for (var n of r)
      Rh(n);
  }
  return t.i = !0, yt = t.p, bc(e);
}
function bc(e = {}) {
  return ah(e, fh, { value: !0 }), e;
}
function rs() {
  return !ts || yt !== null && yt.l === null;
}
let co = [];
function xh() {
  var e = co;
  co = [], pl(e);
}
function Jr(e) {
  if (co.length === 0 && !ks) {
    var t = co;
    queueMicrotask(() => {
      t === co && xh();
    });
  }
  co.push(e);
}
function Wm() {
  for (; co.length > 0; )
    xh();
}
const Hm = -7169;
function At(e, t) {
  e.f = e.f & Hm | t;
}
function xc(e) {
  (e.f & Lr) !== 0 || e.deps === null ? At(e, Rt) : At(e, wr);
}
function yh(e, t, r) {
  (e.f & Mt) !== 0 ? t.add(e) : (e.f & wr) !== 0 && r.add(e), At(e, Rt);
}
function qm(e, t) {
  if (t) {
    const r = document.body;
    e.autofocus = !0, Jr(() => {
      document.activeElement === r && e.focus();
    });
  }
}
let Gu = !1;
function Gm() {
  Gu || (Gu = !0, document.addEventListener(
    "reset",
    (e) => {
      Promise.resolve().then(() => {
        if (!e.defaultPrevented)
          for (
            const t of
            /**@type {HTMLFormElement} */
            e.target.elements
          )
            t[Ti]?.();
      });
    },
    // In the capture phase to guarantee we get noticed of it (no possibility of stopPropagation)
    { capture: !0 }
  ));
}
function ns(e) {
  var t = it, r = ot;
  Sr(null), on(null);
  try {
    return e();
  } finally {
    Sr(t), on(r);
  }
}
function yc(e, t, r, n = r) {
  e.addEventListener(t, () => ns(r));
  const o = (
    /** @type {any} */
    e[Ti]
  );
  o ? e[Ti] = () => {
    o(), n(!0);
  } : e[Ti] = () => n(!0), Gm();
}
function _h(e, t, r, n) {
  const o = rs() ? jo : _c;
  var s = e.filter((p) => !p.settled), i = t.map(o);
  if (r.length === 0 && s.length === 0) {
    n(i);
    return;
  }
  var l = (
    /** @type {Effect} */
    ot
  ), c = Km(), u = s.length === 1 ? s[0].promise : s.length > 1 ? Promise.all(s.map((p) => p.promise)) : null;
  function d(p) {
    if ((l.f & Xt) === 0) {
      c();
      try {
        n([...i, ...p]);
      } catch (v) {
        Yr(v, l);
      }
      qi();
    }
  }
  var f = wh();
  if (r.length === 0) {
    u.then(() => d([])).finally(f);
    return;
  }
  function h() {
    Promise.all(r.map((p) => /* @__PURE__ */ Ym(p))).then(d).catch((p) => Yr(p, l)).finally(f);
  }
  u ? u.then(() => {
    c(), h(), qi();
  }) : h();
}
function Km() {
  var e = (
    /** @type {Effect} */
    ot
  ), t = it, r = yt, n = (
    /** @type {Batch} */
    Qe
  );
  return function(s = !0) {
    on(e), Sr(t), Lo(r), s && (e.f & Xt) === 0 && (n?.activate(), n?.apply());
  };
}
function qi(e = !0) {
  on(null), Sr(null), Lo(null), e && Qe?.deactivate();
}
function wh() {
  var e = (
    /** @type {Effect} */
    ot
  ), t = e.b, r = (
    /** @type {Batch} */
    Qe
  ), n = !!t?.is_rendered();
  return t?.update_pending_count(1, r), r.increment(n, e), () => {
    t?.update_pending_count(-1, r), r.decrement(n, e);
  };
}
// @__NO_SIDE_EFFECTS__
function jo(e) {
  var t = Zt | Mt;
  return ot !== null && (ot.f |= es), {
    ctx: yt,
    deps: null,
    effects: null,
    equals: vh,
    f: t,
    fn: e,
    reactions: null,
    rv: 0,
    v: (
      /** @type {V} */
      Tt
    ),
    wv: 0,
    parent: ot,
    ac: null
  };
}
const vs = /* @__PURE__ */ Symbol("obsolete");
// @__NO_SIDE_EFFECTS__
function Ym(e, t, r) {
  let n = (
    /** @type {Effect | null} */
    ot
  );
  n === null && Em();
  var o = (
    /** @type {Promise<V>} */
    /** @type {unknown} */
    void 0
  ), s = xn(
    /** @type {V} */
    Tt
  ), i = !it, l = /* @__PURE__ */ new Set();
  return cb(() => {
    var c = (
      /** @type {Effect} */
      ot
    ), u = uh();
    o = u.promise;
    try {
      Promise.resolve(e()).then(u.resolve, (p) => {
        p !== Bs && u.reject(p);
      }).finally(qi);
    } catch (p) {
      u.reject(p), qi();
    }
    var d = (
      /** @type {Batch} */
      Qe
    );
    if (i) {
      if ((c.f & Qo) !== 0)
        var f = wh();
      if (
        // boundary can be null if the async derived is inside an $effect.root not connected to the component render tree
        n.b?.is_rendered()
      )
        d.async_deriveds.get(c)?.reject(vs);
      else
        for (const p of l.values())
          p.reject(vs);
      l.add(u), d.async_deriveds.set(c, u);
    }
    const h = (p, v = void 0) => {
      f?.(), l.delete(u), v !== vs && (d.activate(), v ? (s.f |= Zn, Vo(s, v)) : ((s.f & Zn) !== 0 && (s.f ^= Zn), Vo(s, p)), d.deactivate());
    };
    u.promise.then(h, (p) => h(null, p || "unknown"));
  }), ya(() => {
    for (const c of l)
      c.reject(vs);
  }), new Promise((c) => {
    function u(d) {
      function f() {
        d === o ? c(s) : u(o);
      }
      d.then(f, f);
    }
    u(o);
  });
}
// @__NO_SIDE_EFFECTS__
function T(e) {
  const t = /* @__PURE__ */ jo(e);
  return Zh(t), t;
}
// @__NO_SIDE_EFFECTS__
function _c(e) {
  const t = /* @__PURE__ */ jo(e);
  return t.equals = mh, t;
}
function Xm(e) {
  var t = e.effects;
  if (t !== null) {
    e.effects = null;
    for (var r = 0; r < t.length; r += 1)
      jt(
        /** @type {Effect} */
        t[r]
      );
  }
}
function wc(e) {
  var t, r = ot, n = e.parent;
  if (!yn && n !== null && e.v !== Tt && // if it was never evaluated before, it's guaranteed to fail downstream, so we try to execute instead
  (n.f & (Xt | Yt)) !== 0)
    return $m(), e.v;
  on(n);
  try {
    Xm(e), t = Hh(e);
  } finally {
    on(r);
  }
  return t;
}
function kh(e) {
  var t = wc(e);
  if (!e.equals(t) && (e.wv = Bh(), (!Qe?.is_fork || e.deps === null) && (Qe !== null ? (Qe.capture(e, t, !0), xl?.capture(e, t, !0)) : e.v = t, e.deps === null))) {
    At(e, Rt);
    return;
  }
  yn || (Pr !== null ? (zc() || Qe?.is_fork) && Pr.set(e, t) : xc(e));
}
function Jm(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      (t.teardown || t.ac) && (t.teardown?.(), t.ac !== null && ns(() => {
        t.ac.abort(Bs), t.ac = null;
      }), t.fn !== null && (t.teardown = dt), Cs(t, 0), Ec(t));
}
function Sh(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      t.teardown && t.fn !== null && Fo(t);
}
let Va = null, Ao = null, Qe = null, xl = null, Pr = null, yl = null, ks = !1, Fa = !1, Ss = null, Oi = null;
var Ku = 0;
let Qm = 1;
class Un {
  id = Qm++;
  /** True as soon as `#process` was called */
  #e = !1;
  linked = !0;
  /** @type {Batch | null} */
  #t = null;
  /** @type {Batch | null} */
  #r = null;
  /** @type {Map<Effect, ReturnType<typeof deferred<any>>>} */
  async_deriveds = /* @__PURE__ */ new Map();
  /**
   * The current values of any signals that are updated in this batch.
   * Tuple format: [value, is_derived] (note: is_derived is false for deriveds, too, if they were overridden via assignment)
   * They keys of this map are identical to `this.#previous`
   * @type {Map<Value, [any, boolean]>}
   */
  current = /* @__PURE__ */ new Map();
  /**
   * The values of any signals (sources and deriveds) that are updated in this batch _before_ those updates took place.
   * They keys of this map are identical to `this.#current`
   * @type {Map<Value, any>}
   */
  previous = /* @__PURE__ */ new Map();
  /**
   * When the batch is committed (and the DOM is updated), we need to remove old branches
   * and append new ones by calling the functions added inside (if/each/key/etc) blocks
   * @type {Set<(batch: Batch) => void>}
   */
  #o = /* @__PURE__ */ new Set();
  /**
   * If a fork is discarded, we need to destroy any effects that are no longer needed
   * @type {Set<(batch: Batch) => void>}
   */
  #n = /* @__PURE__ */ new Set();
  /**
   * The number of async effects that are currently in flight
   */
  #s = 0;
  /**
   * Async effects that are currently in flight, _not_ inside a pending boundary
   * @type {Map<Effect, number>}
   */
  #i = /* @__PURE__ */ new Map();
  /**
   * A deferred that resolves when the batch is committed, used with `settled()`
   * TODO replace with Promise.withResolvers once supported widely enough
   * @type {{ promise: Promise<void>, resolve: (value?: any) => void, reject: (reason: unknown) => void } | null}
   */
  #l = null;
  /**
   * Effects that were scheduled in this batch but not yet 'resolved' into the
   * root effects that need to be flushed. Resolving — the upwards traversal that
   * marks the path to each effect on the shared effect tree (see #resolve) — is
   * deferred until the batch is processed, so that the markers are created and
   * consumed within a single traversal. Scheduling into other batches (which can
   * happen concurrently, e.g. while a batch is committed) can therefore never
   * observe (and be confused by) this batch's markers.
   * May contain duplicates — deduplication happens during resolving
   * @type {Effect[]}
   */
  #a = [];
  /**
   * Effects created while this batch was active.
   * @type {Effect[]}
   */
  #f = [];
  /**
   * Deferred effects (which run after async work has completed) that are DIRTY
   * @type {Set<Effect>}
   */
  #c = /* @__PURE__ */ new Set();
  /**
   * Deferred effects that are MAYBE_DIRTY
   * @type {Set<Effect>}
   */
  #u = /* @__PURE__ */ new Set();
  /**
   * A map of branches that still exist, but will be destroyed when this batch
   * is committed — we skip over these during `process`.
   * The value contains child effects that were dirty/maybe_dirty before being reset,
   * so they can be rescheduled if the branch survives.
   * @type {Map<Effect, { d: Effect[], m: Effect[] }>}
   */
  #h = /* @__PURE__ */ new Map();
  /**
   * Inverse of #skipped_branches which we need to tell prior batches to unskip them when committing
   * @type {Set<Effect>}
   */
  #v = /* @__PURE__ */ new Set();
  is_fork = !1;
  #d = !1;
  constructor() {
    Ao === null ? Va = Ao = this : (Ao.#r = this, this.#t = Ao), Ao = this;
  }
  #g() {
    if (this.is_fork) return !0;
    for (const n of this.#i.keys()) {
      for (var t = n, r = !1; t.parent !== null; ) {
        if (this.#h.has(t)) {
          r = !0;
          break;
        }
        t = t.parent;
      }
      if (!r)
        return !0;
    }
    return !1;
  }
  /**
   * Add an effect to the #skipped_branches map and reset its children
   * @param {Effect} effect
   */
  skip_effect(t) {
    this.#h.has(t) || this.#h.set(t, { d: [], m: [] }), this.#v.delete(t);
  }
  /**
   * Remove an effect from the #skipped_branches map and reschedule
   * any tracked dirty/maybe_dirty child effects
   * @param {Effect} effect
   * @param {(e: Effect) => void} callback
   */
  unskip_effect(t, r = (n) => this.schedule(n)) {
    var n = this.#h.get(t);
    if (n) {
      this.#h.delete(t);
      for (var o of n.d)
        At(o, Mt), r(o);
      for (o of n.m)
        At(o, wr), r(o);
    }
    this.#v.add(t);
  }
  /**
   * Convert the effects that were scheduled in this batch into the root effects
   * that need to be traversed, marking the path to each effect (by clearing the
   * `CLEAN` flag on ancestor branches) so that the traversal can find them.
   * This happens right before traversal rather than at scheduling time, so that
   * the markers left on the (shared) effect tree are created and consumed within
   * a single traversal — scheduling into other batches can never observe them
   * @returns {Effect[]}
   */
  #y() {
    var t = [];
    for (const s of this.#a)
      if (!((s.f & Xt) !== 0 || (s.f & (Mt | wr)) === 0)) {
        for (var r = s, n = !1; r.parent !== null; ) {
          r = r.parent;
          var o = r.f;
          if ((o & (mn | kr)) !== 0) {
            if ((o & Rt) === 0) {
              n = !0;
              break;
            }
            r.f ^= Rt;
          }
        }
        n || t.push(r);
      }
    return this.#a = [], t;
  }
  #m() {
    this.#e = !0;
    for (const l of this.#c)
      this.#u.delete(l), At(l, Mt), this.schedule(l);
    for (const l of this.#u)
      At(l, wr), this.schedule(l);
    this.apply();
    for (var t = Ss = [], r = [], n = Oi = []; this.#a.length > 0; ) {
      Ku++ > 1e3 && (this.#x(), tb());
      for (const l of this.#y())
        try {
          this.#b(l, t, r);
        } catch (c) {
          throw Ah(l), this.#g() || this.discard(), c;
        }
    }
    if (Qe = null, n.length > 0) {
      var o = Un.ensure();
      for (const l of n)
        o.schedule(l);
    }
    if (Ss = null, Oi = null, this.#g()) {
      this.#p(r), this.#p(t);
      for (const [l, c] of this.#h)
        zh(l, c);
      n.length > 0 && /** @type {unknown} */
      Qe.#m();
      return;
    }
    const s = this.#k();
    if (s) {
      this.#p(r), this.#p(t), s.#_(this);
      return;
    }
    this.#c.clear(), this.#u.clear();
    for (const l of this.#o) l(this);
    this.#o.clear(), xl = this, Yu(r), Yu(t), xl = null, this.#l?.resolve();
    var i = (
      /** @type {Batch | null} */
      /** @type {unknown} */
      Qe
    );
    if (this.#s === 0 && (this.#a.length === 0 || i !== null) && this.#x(), this.#a.length > 0)
      if (i !== null) {
        for (const l of this.#a)
          i.#a.push(l);
        this.#a = [];
      } else
        i = this;
    i !== null && (en.clear(), i.#m());
  }
  /**
   * Traverse the effect tree, executing effects or stashing
   * them for later execution as appropriate
   * @param {Effect} root
   * @param {Effect[]} effects
   * @param {Effect[]} render_effects
   */
  #b(t, r, n) {
    t.f ^= Rt;
    for (var o = t.first; o !== null; ) {
      var s = o.f, i = (s & (kr | mn)) !== 0, l = i && (s & Rt) !== 0, c = l || (s & Yt) !== 0 || this.#h.has(o);
      if (!c && o.fn !== null) {
        i ? o.f ^= Rt : (s & Do) !== 0 ? r.push(o) : Gs(o) && ((s & Nr) !== 0 && this.#u.add(o), Fo(o));
        var u = o.first;
        if (u !== null) {
          o = u;
          continue;
        }
      }
      for (; o !== null; ) {
        var d = o.next;
        if (d !== null) {
          o = d;
          break;
        }
        o = o.parent;
      }
    }
  }
  #k() {
    for (var t = this.#t; t !== null; ) {
      if (!t.is_fork) {
        for (const [r, [, n]] of this.current)
          if (t.current.has(r) && !n)
            return t;
      }
      t = t.#t;
    }
    return null;
  }
  /**
   * @param {Batch} batch
   */
  #_(t) {
    for (const [n, o] of t.current)
      !this.previous.has(n) && t.previous.has(n) && this.previous.set(n, t.previous.get(n)), this.current.set(n, o);
    for (const [n, o] of t.async_deriveds) {
      const s = this.async_deriveds.get(n);
      s && o.promise.then(s.resolve).catch(s.reject);
    }
    t.async_deriveds.clear(), this.transfer_effects(t.#c, t.#u);
    const r = (n) => {
      var o = n.reactions;
      if (o !== null && !((n.f & Zt) !== 0 && (n.f & (Mt | wr)) === 0))
        for (const l of o) {
          var s = l.f;
          if ((s & Zt) !== 0)
            r(
              /** @type {Derived} */
              l
            );
          else {
            var i = (
              /** @type {Effect} */
              l
            );
            s & (Oo | Nr) && !this.async_deriveds.has(i) && (this.#u.delete(i), At(i, Mt), this.schedule(i));
          }
        }
    };
    for (const n of this.current.keys())
      r(n);
    this.oncommit(() => t.discard()), t.#x(), Qe = this, this.#m();
  }
  /**
   * @param {Effect[]} effects
   */
  #p(t) {
    for (var r = 0; r < t.length; r += 1)
      yh(t[r], this.#c, this.#u);
  }
  /**
   * Associate a change to a given source with the current
   * batch, noting its previous and current values
   * @param {Value} source
   * @param {any} value
   * @param {boolean} [is_derived]
   */
  capture(t, r, n = !1) {
    t.v !== Tt && !this.previous.has(t) && this.previous.set(t, t.v), (t.f & Zn) === 0 && (this.current.set(t, [r, n]), Pr?.set(t, r)), this.is_fork || (t.v = r);
  }
  activate() {
    Qe = this;
  }
  deactivate() {
    Qe = null, Pr = null;
  }
  flush() {
    try {
      Fa = !0, Qe = this, this.#m();
    } finally {
      Ku = 0, yl = null, Ss = null, Oi = null, Fa = !1, Qe = null, Pr = null, en.clear();
    }
  }
  discard() {
    for (const t of this.#n) t(this);
    this.#n.clear();
    for (const t of this.async_deriveds.values())
      t.reject(vs);
    this.#x(), this.#l?.resolve();
  }
  /**
   * @param {Effect} effect
   */
  register_created_effect(t) {
    this.#f.push(t);
  }
  #w() {
    for (let f = Va; f !== null; f = f.#r) {
      var t = f.id < this.id, r = [];
      for (const [h, [p, v]] of this.current) {
        if (f.current.has(h)) {
          var n = (
            /** @type {[any, boolean]} */
            f.current.get(h)[0]
          );
          if (t && p !== n)
            f.current.set(h, [p, v]);
          else
            continue;
        }
        r.push(h);
      }
      if (t)
        for (const [h, p] of this.async_deriveds) {
          const v = f.async_deriveds.get(h);
          v && p.promise.then(v.resolve).catch(v.reject);
        }
      var o = [...f.current.keys()].filter(
        (h) => !/** @type {[any, boolean]} */
        f.current.get(h)[1]
      );
      if (!(!f.#e || o.length === 0)) {
        var s = o.filter((h) => !this.current.has(h));
        if (s.length === 0)
          t && f.discard();
        else if (r.length > 0) {
          if (t)
            for (const h of this.#v)
              f.unskip_effect(h, (p) => {
                (p.f & (Nr | Oo)) !== 0 ? f.schedule(p) : f.#p([p]);
              });
          f.activate();
          var i = /* @__PURE__ */ new Set(), l = /* @__PURE__ */ new Map();
          for (var c of r)
            $h(c, s, i, l);
          l = /* @__PURE__ */ new Map();
          var u = [...f.current].filter(([h, p]) => {
            const v = this.current.get(h);
            return v ? v[0] !== p[0] || v[1] !== p[1] : !0;
          }).map(([h]) => h);
          if (u.length > 0)
            for (const h of this.#f)
              (h.f & (Xt | Yt | Wi)) === 0 && kc(h, u, l) && ((h.f & (Oo | Nr)) !== 0 ? (At(h, Mt), f.schedule(h)) : f.#c.add(h));
          if (f.#a.length > 0 && !f.#d) {
            f.apply();
            for (var d of f.#y())
              f.#b(d, [], []);
          }
          f.deactivate();
        }
      }
    }
  }
  /**
   * @param {boolean} blocking
   * @param {Effect} effect
   */
  increment(t, r) {
    if (this.#s += 1, t) {
      let n = this.#i.get(r) ?? 0;
      this.#i.set(r, n + 1);
    }
  }
  /**
   * @param {boolean} blocking
   * @param {Effect} effect
   */
  decrement(t, r) {
    if (this.#s -= 1, t) {
      let n = this.#i.get(r) ?? 0;
      n === 1 ? this.#i.delete(r) : this.#i.set(r, n - 1);
    }
    this.#d || (this.#d = !0, Jr(() => {
      this.#d = !1, this.linked && this.flush();
    }));
  }
  /**
   * @param {Set<Effect>} dirty_effects
   * @param {Set<Effect>} maybe_dirty_effects
   */
  transfer_effects(t, r) {
    for (const n of t)
      this.#c.add(n);
    for (const n of r)
      this.#u.add(n);
    t.clear(), r.clear();
  }
  /** @param {(batch: Batch) => void} fn */
  oncommit(t) {
    this.#o.add(t);
  }
  /** @param {(batch: Batch) => void} fn */
  ondiscard(t) {
    this.#n.add(t);
  }
  settled() {
    return (this.#l ??= uh()).promise;
  }
  static ensure() {
    if (Qe === null) {
      const t = Qe = new Un();
      !Fa && !ks && Jr(() => {
        t.#e || t.flush();
      });
    }
    return Qe;
  }
  apply() {
    {
      Pr = null;
      return;
    }
  }
  /**
   *
   * @param {Effect} effect
   */
  schedule(t) {
    if (yl = t, t.b?.is_pending && (t.f & (Do | Us | pc)) !== 0 && (t.f & Qo) === 0) {
      t.b.defer_effect(t);
      return;
    }
    this.#a.push(t);
  }
  #x() {
    if (this.linked) {
      var t = this.#t, r = this.#r;
      t === null ? Va = r : t.#r = r, r === null ? Ao = t : r.#t = t, this.linked = !1;
    }
  }
}
function eb(e) {
  var t = ks;
  ks = !0;
  try {
    for (var r; ; ) {
      if (Wm(), Qe === null)
        return (
          /** @type {T} */
          r
        );
      Qe.flush();
    }
  } finally {
    ks = t;
  }
}
function tb() {
  try {
    Nm();
  } catch (e) {
    Yr(e, yl);
  }
}
let fn = null;
function Yu(e) {
  var t = e.length;
  if (t !== 0) {
    for (var r = 0; r < t; ) {
      var n = e[r++];
      if ((n.f & (Xt | Yt)) === 0 && Gs(n) && (fn = /* @__PURE__ */ new Set(), Fo(n), n.deps === null && n.first === null && n.nodes === null && n.teardown === null && n.ac === null && jh(n), fn?.size > 0)) {
        en.clear();
        for (const o of fn) {
          if ((o.f & (Xt | Yt)) !== 0) continue;
          const s = [o];
          let i = o.parent;
          for (; i !== null; )
            fn.has(i) && (fn.delete(i), s.push(i)), i = i.parent;
          for (let l = s.length - 1; l >= 0; l--) {
            const c = s[l];
            (c.f & (Xt | Yt)) === 0 && Fo(c);
          }
        }
        fn.clear();
      }
    }
    fn = null;
  }
}
function $h(e, t, r, n) {
  if (!r.has(e) && (r.add(e), e.reactions !== null))
    for (const o of e.reactions) {
      const s = o.f;
      (s & Zt) !== 0 ? $h(
        /** @type {Derived} */
        o,
        t,
        r,
        n
      ) : (s & (Oo | Nr)) !== 0 && (s & Mt) === 0 && kc(o, t, n) && (At(o, Mt), Sc(
        /** @type {Effect} */
        o
      ));
    }
}
function kc(e, t, r) {
  const n = r.get(e);
  if (n !== void 0) return n;
  if (e.deps !== null)
    for (const o of e.deps) {
      if (Ui.call(t, o))
        return !0;
      if ((o.f & Zt) !== 0 && kc(
        /** @type {Derived} */
        o,
        t,
        r
      ))
        return r.set(
          /** @type {Derived} */
          o,
          !0
        ), !0;
    }
  return r.set(e, !1), !1;
}
function Sc(e) {
  Qe.schedule(e);
}
function zh(e, t) {
  if (!((e.f & kr) !== 0 && (e.f & Rt) !== 0)) {
    (e.f & Mt) !== 0 ? t.d.push(e) : (e.f & wr) !== 0 && t.m.push(e), At(e, Rt);
    for (var r = e.first; r !== null; )
      zh(r, t), r = r.next;
  }
}
function Ah(e) {
  At(e, Rt);
  for (var t = e.first; t !== null; )
    Ah(t), t = t.next;
}
let Gi = /* @__PURE__ */ new Set();
const en = /* @__PURE__ */ new Map();
let Eh = !1;
function xn(e, t) {
  var r = {
    f: 0,
    // TODO ideally we could skip this altogether, but it causes type errors
    v: e,
    reactions: null,
    equals: vh,
    rv: 0,
    wv: 0
  };
  return r;
}
// @__NO_SIDE_EFFECTS__
function he(e, t) {
  const r = xn(e);
  return Zh(r), r;
}
// @__NO_SIDE_EFFECTS__
function rb(e, t = !1, r = !0) {
  const n = xn(e);
  return t || (n.equals = mh), ts && r && yt !== null && yt.l !== null && (yt.l.s ??= []).push(n), n;
}
function Z(e, t, r = !1) {
  it !== null && // since we are untracking the function inside `$inspect.with` we need to add this check
  // to ensure we error if state is set inside an inspect effect
  (!Ir || (it.f & Wi) !== 0) && rs() && (it.f & (Zt | Nr | Oo | Wi)) !== 0 && (rn === null || !rn.has(e)) && Dm();
  let n = r ? Gt(t) : t;
  return Vo(e, n, Oi);
}
var ao = null, _l = 0;
function Vo(e, t, r = null) {
  if (!e.equals(t)) {
    yn ? en.set(e, t) : en.has(e) || en.set(e, e.v);
    var n = Un.ensure();
    if (n.capture(e, t), (e.f & Zt) !== 0) {
      const o = (
        /** @type {Derived} */
        e
      );
      (e.f & Mt) !== 0 && wc(o), Pr === null && xc(o);
    }
    e.wv = Bh(), ao = null, _l = 0, Mh(e, Mt, r), ao = null, rs() && ot !== null && (ot.f & Rt) !== 0 && (ot.f & (kr | mn)) === 0 && (xr === null ? fb([e]) : xr.push(e)), !n.is_fork && Gi.size > 0 && !Eh && nb();
  }
  return t;
}
function nb() {
  Eh = !1;
  for (const e of Gi) {
    (e.f & Rt) !== 0 && At(e, wr);
    let t;
    try {
      t = Gs(e);
    } catch {
      t = !0;
    }
    t && Fo(e);
  }
  Gi.clear();
}
function cr(e) {
  Z(e, e.v + 1);
}
function Mh(e, t, r) {
  var n = e.reactions;
  if (n !== null) {
    var o = rs(), s = n.length;
    if (_l += s, _l > 1e5 && ao === null && (ao = /* @__PURE__ */ new Set()), ao !== null) {
      if (ao.has(e)) return;
      ao.add(e);
    }
    for (var i = 0; i < s; i++) {
      var l = n[i], c = l.f;
      if (!(!o && l === ot)) {
        var u = (c & Mt) === 0;
        if (u && At(l, t), (c & Wi) !== 0)
          Gi.add(
            /** @type {Effect} */
            l
          );
        else if ((c & Zt) !== 0) {
          var d = (
            /** @type {Derived} */
            l
          );
          Pr?.delete(d), Mh(d, wr, r);
        } else if (u) {
          var f = (
            /** @type {Effect} */
            l
          );
          (c & Nr) !== 0 && fn !== null && fn.add(f), r !== null ? r.push(f) : Sc(f);
        }
      }
    }
  }
}
function Gt(e) {
  if (typeof e != "object" || e === null || Qr in e || fh in e)
    return e;
  const t = xa(e);
  if (t !== ch && t !== ym)
    return e;
  var r = /* @__PURE__ */ new Map(), n = Zs(e), o = /* @__PURE__ */ he(0), s = jr, i = (l) => {
    if (jr === s)
      return l();
    var c = it, u = jr;
    Sr(null), Qu(s);
    var d = l();
    return Sr(c), Qu(u), d;
  };
  return n && r.set("length", /* @__PURE__ */ he(
    /** @type {any[]} */
    e.length
  )), new Proxy(
    /** @type {any} */
    e,
    {
      defineProperty(l, c, u) {
        (!("value" in u) || u.configurable === !1 || u.enumerable === !1 || u.writable === !1) && Im();
        var d = r.get(c);
        return d === void 0 ? i(() => {
          var f = /* @__PURE__ */ he(u.value);
          return r.set(c, f), f;
        }) : Z(d, u.value, !0), !0;
      },
      deleteProperty(l, c) {
        var u = r.get(c);
        if (u === void 0) {
          if (c in l) {
            const d = i(() => /* @__PURE__ */ he(Tt));
            r.set(c, d), cr(o);
          }
        } else
          Z(u, Tt), cr(o);
        return !0;
      },
      get(l, c, u) {
        if (c === Qr)
          return e;
        var d = r.get(c), f = c in l;
        if (d === void 0 && (!f || Fn(l, c)?.writable) && (d = i(() => {
          var p = Gt(f ? l[c] : Tt), v = /* @__PURE__ */ he(p);
          return v;
        }), r.set(c, d)), d !== void 0) {
          var h = a(d);
          return h === Tt ? void 0 : h;
        }
        return Reflect.get(l, c, u);
      },
      getOwnPropertyDescriptor(l, c) {
        this.has?.(l, c);
        var u = Reflect.getOwnPropertyDescriptor(l, c), d = r.get(c);
        if (d !== void 0) {
          var f = a(d);
          if (f === Tt)
            return;
          if (u && "value" in u)
            u.value = f;
          else
            return {
              enumerable: !0,
              configurable: !0,
              value: f,
              writable: !0
            };
        }
        return u;
      },
      has(l, c) {
        if (c === Qr)
          return !0;
        var u = r.get(c), d = u !== void 0 && u.v !== Tt || Reflect.has(l, c);
        if (u !== void 0 || ot !== null && (!d || Fn(l, c)?.writable)) {
          u === void 0 && (u = i(() => {
            var h = d ? Gt(l[c]) : Tt, p = /* @__PURE__ */ he(h);
            return p;
          }), r.set(c, u));
          var f = a(u);
          if (f === Tt)
            return !1;
        }
        return d;
      },
      set(l, c, u, d) {
        var f = r.get(c), h = c in l;
        if (n && c === "length")
          for (var p = u; p < /** @type {Source<number>} */
          f.v; p += 1) {
            var v = r.get(p + "");
            v !== void 0 ? Z(v, Tt) : p in l && (v = i(() => /* @__PURE__ */ he(Tt)), r.set(p + "", v));
          }
        if (f === void 0)
          (!h || Fn(l, c)?.writable) && (f = i(() => /* @__PURE__ */ he(void 0)), Z(f, Gt(u)), r.set(c, f));
        else {
          h = f.v !== Tt;
          var g = i(() => Gt(u));
          Z(f, g);
        }
        var y = Reflect.getOwnPropertyDescriptor(l, c);
        if (y?.set && y.set.call(d, u), !h) {
          if (n && typeof c == "string") {
            var _ = (
              /** @type {Source<number>} */
              r.get("length")
            ), k = Number(c);
            Number.isInteger(k) && k >= _.v && Z(_, k + 1);
          }
          cr(o);
        }
        return !0;
      },
      ownKeys(l) {
        a(o);
        var c = Reflect.ownKeys(l).filter((f) => {
          var h = r.get(f);
          return h === void 0 || h.v !== Tt;
        });
        for (var [u, d] of r)
          d.v !== Tt && !(u in l) && c.push(u);
        return c;
      },
      setPrototypeOf() {
        Rm();
      }
    }
  );
}
function Xu(e) {
  try {
    if (e !== null && typeof e == "object" && Qr in e)
      return e[Qr];
  } catch {
  }
  return e;
}
function Th(e, t) {
  return Object.is(Xu(e), Xu(t));
}
var wl, Ch, Oh, Nh;
function ob() {
  if (wl === void 0) {
    wl = window, Ch = /Firefox/.test(navigator.userAgent);
    var e = Element.prototype, t = Node.prototype, r = Text.prototype;
    Oh = Fn(t, "firstChild").get, Nh = Fn(t, "nextSibling").get, qu(e) && (e[gl] = void 0, e[ph] = null, e[ml] = void 0, e.__e = void 0), qu(r) && (r[bl] = void 0);
  }
}
function tn(e = "") {
  return document.createTextNode(e);
}
// @__NO_SIDE_EFFECTS__
function Kr(e) {
  return (
    /** @type {TemplateNode | null} */
    Oh.call(e)
  );
}
// @__NO_SIDE_EFFECTS__
function Hs(e) {
  return (
    /** @type {TemplateNode | null} */
    Nh.call(e)
  );
}
function M(e, t) {
  return /* @__PURE__ */ Kr(e);
}
function re(e, t = !1) {
  {
    var r = /* @__PURE__ */ Kr(e);
    return r instanceof Comment && r.data === "" ? /* @__PURE__ */ Hs(r) : r;
  }
}
function j(e, t = !1) {
  return /* @__PURE__ */ Kr(e);
}
function m(e, t = 1, r = !1) {
  let n = e;
  for (; t--; )
    n = /** @type {TemplateNode} */
    /* @__PURE__ */ Hs(n);
  return n;
}
function sb(e) {
  e.textContent = "";
}
function Ph() {
  return !1;
}
function $c(e, t, r) {
  return t == null || t === oh ? (
    /** @type {T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : Element} */
    r ? document.createElement(e, { is: r }) : document.createElement(e)
  ) : (
    /** @type {T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : Element} */
    r ? document.createElementNS(t, e, { is: r }) : document.createElementNS(t, e)
  );
}
function ib(e) {
  var t = ot;
  if (t === null)
    return it.f |= Zn, e;
  if ((t.f & Qo) === 0 && (t.f & Do) === 0)
    throw e;
  Yr(e, t);
}
function Yr(e, t) {
  if (!(t !== null && (t.f & Xt) !== 0)) {
    for (; t !== null; ) {
      if ((t.f & vl) !== 0 && (t.f & (Xt | Bi)) === 0) {
        if ((t.f & Qo) === 0)
          throw e;
        try {
          t.b.error(e);
          return;
        } catch (r) {
          e = r;
        }
      }
      t = t.parent;
    }
    throw e;
  }
}
function Ih(e) {
  ot === null && (it === null && Om(), Cm()), yn && Tm();
}
function ab(e, t) {
  var r = t.last;
  r === null ? t.last = t.first = e : (r.next = e, e.prev = r, t.last = e);
}
function Fr(e, t) {
  var r = ot;
  r !== null && (r.f & Yt) !== 0 && (e |= Yt);
  var n = {
    ctx: yt,
    deps: null,
    nodes: null,
    f: e | Mt | Lr,
    first: null,
    fn: t,
    last: null,
    next: null,
    parent: r,
    b: r && r.b,
    prev: null,
    teardown: null,
    wv: 0,
    ac: null
  };
  Qe?.register_created_effect(n);
  var o = n;
  if ((e & Do) !== 0)
    Ss !== null ? Ss.push(n) : Un.ensure().schedule(n);
  else if (t !== null) {
    try {
      Fo(n);
    } catch (i) {
      throw jt(n), i;
    }
    o.deps === null && o.teardown === null && o.nodes === null && o.first === o.last && // either `null`, or a singular child
    (o.f & es) === 0 && (o = o.first, (e & Nr) !== 0 && (e & bn) !== 0 && o !== null && (o.f |= bn));
  }
  if (o !== null && (o.parent = r, r !== null && ab(o, r), it !== null && (it.f & Zt) !== 0 && (e & mn) === 0)) {
    var s = (
      /** @type {Derived} */
      it
    );
    (s.effects ??= []).push(o);
  }
  return n;
}
function zc() {
  return it !== null && !Ir;
}
function ya(e) {
  const t = Fr(Us, null);
  return At(t, Rt), t.teardown = e, t;
}
function _t(e) {
  Ih();
  var t = (
    /** @type {Effect} */
    ot.f
  ), r = !it && (t & kr) !== 0 && yt !== null && !yt.i;
  if (r) {
    var n = (
      /** @type {ComponentContext} */
      yt
    );
    (n.e ??= []).push(e);
  } else
    return Rh(e);
}
function Rh(e) {
  return Fr(Do | dh, e);
}
function Ac(e) {
  return Ih(), Fr(Us | dh, e);
}
function lb(e) {
  Un.ensure();
  const t = Fr(mn | es, e);
  return (r = {}) => new Promise((n) => {
    r.outro ? ho(t, () => {
      jt(t), n(void 0);
    }) : (jt(t), n(void 0));
  });
}
function wo(e) {
  return Fr(Do, e);
}
function cb(e) {
  return Fr(Oo | es, e);
}
function qs(e, t = 0) {
  return Fr(Us | t, e);
}
function L(e, t = [], r = [], n = []) {
  _h(n, t, r, (o) => {
    Fr(Us, () => {
      e(...o.map(a));
    });
  });
}
function ko(e, t = 0) {
  var r = Fr(Nr | t, e);
  return r;
}
function Dh(e, t = 0) {
  var r = Fr(pc | t, e);
  return r;
}
function tr(e) {
  return Fr(kr | es, e);
}
function Lh(e) {
  var t = e.teardown;
  if (t !== null) {
    const r = yn, n = it;
    Ju(!0), Sr(null);
    try {
      t.call(null);
    } catch (o) {
      Yr(o, e.parent);
    } finally {
      Ju(r), Sr(n);
    }
  }
}
function Ec(e, t = !1) {
  var r = e.first;
  for (e.first = e.last = null; r !== null; ) {
    const o = r.ac;
    o !== null && ns(() => {
      o.abort(Bs);
    });
    var n = r.next;
    (r.f & mn) !== 0 ? r.parent = null : jt(r, t), r = n;
  }
}
function ub(e) {
  for (var t = e.first; t !== null; ) {
    var r = t.next;
    (t.f & kr) === 0 && jt(t), t = r;
  }
}
function jt(e, t = !0) {
  var r = !1;
  (t || (e.f & km) !== 0) && e.nodes !== null && e.nodes.end !== null && (db(
    e.nodes.start,
    /** @type {TemplateNode} */
    e.nodes.end
  ), r = !0), e.f |= Bi, Ec(e, t && !r), Cs(e, 0);
  var n = e.nodes && e.nodes.t;
  if (n !== null)
    for (const s of n)
      s.stop();
  Lh(e), e.f ^= Bi, e.f |= Xt;
  var o = e.parent;
  o !== null && o.first !== null && jh(e), e.next = e.prev = e.teardown = e.ctx = e.deps = e.fn = e.nodes = e.ac = e.b = null;
}
function db(e, t) {
  for (; e !== null; ) {
    var r = e === t ? null : /* @__PURE__ */ Hs(e);
    e.remove(), e = r;
  }
}
function jh(e) {
  var t = e.parent, r = e.prev, n = e.next;
  r !== null && (r.next = n), n !== null && (n.prev = r), t !== null && (t.first === e && (t.first = n), t.last === e && (t.last = r));
}
function ho(e, t, r = !0) {
  var n = [];
  e.f |= vc, Vh(e, n, !0);
  var o = () => {
    r && jt(e), t && t();
  }, s = n.length;
  if (s > 0) {
    var i = () => --s || o();
    for (var l of n)
      l.out(i);
  } else
    o();
}
function Vh(e, t, r) {
  if ((e.f & Yt) === 0) {
    e.f ^= Yt;
    var n = e.nodes && e.nodes.t;
    if (n !== null)
      for (const l of n)
        (l.is_global || r) && t.push(l);
    for (var o = e.first; o !== null; ) {
      var s = o.next;
      if ((o.f & mn) === 0) {
        var i = (o.f & bn) !== 0 || // If this is a branch effect without a block effect parent,
        // it means the parent block effect was pruned. In that case,
        // transparency information was transferred to the branch effect.
        (o.f & kr) !== 0 && (e.f & Nr) !== 0;
        Vh(o, t, i ? r : !1);
      }
      o = s;
    }
  }
}
function Ki(e) {
  e.f &= ~vc, Fh(e, !0);
}
function Fh(e, t) {
  if ((e.f & vc) === 0 && (e.f & Yt) !== 0) {
    e.f ^= Yt, (e.f & Rt) === 0 && (At(e, Mt), Un.ensure().schedule(e));
    for (var r = e.first; r !== null; ) {
      var n = r.next, o = (r.f & bn) !== 0 || (r.f & kr) !== 0;
      Fh(r, o ? t : !1), r = n;
    }
    var s = e.nodes && e.nodes.t;
    if (s !== null)
      for (const i of s)
        (i.is_global || t) && i.in();
  }
}
function Mc(e, t) {
  if (e.nodes)
    for (var r = e.nodes.start, n = e.nodes.end; r !== null; ) {
      var o = r === n ? null : /* @__PURE__ */ Hs(r);
      t.append(r), r = o;
    }
}
let Ni = !1, yn = !1;
function Ju(e) {
  yn = e;
}
let it = null, Ir = !1;
function Sr(e) {
  it = e;
}
let ot = null;
function on(e) {
  ot = e;
}
let rn = null;
function Zh(e) {
  it !== null && ((it.f & Hi) !== 0 || (it.f & Zt) !== 0) && (rn ??= /* @__PURE__ */ new Set()).add(e);
}
let rr = null, lr = 0, xr = null;
function fb(e) {
  xr = e;
}
let Uh = 1, uo = 0, jr = uo;
function Qu(e) {
  jr = e;
}
function Bh() {
  return ++Uh;
}
function Gs(e) {
  var t = e.f;
  if ((t & Mt) !== 0)
    return !0;
  if ((t & wr) !== 0) {
    for (var r = (
      /** @type {Value[]} */
      e.deps
    ), n = r.length, o = 0; o < n; o++) {
      var s = r[o];
      if (Gs(
        /** @type {Derived} */
        s
      ) && kh(
        /** @type {Derived} */
        s
      ), s.wv > e.wv)
        return !0;
    }
    (t & Lr) !== 0 && // During time traveling we don't want to reset the status so that
    // traversal of the graph in the other batches still happens
    Pr === null && At(e, Rt);
  }
  return !1;
}
function Wh(e, t, r = !0) {
  var n = e.reactions;
  if (n !== null && !(rn !== null && rn.has(e)))
    for (var o = 0; o < n.length; o++) {
      var s = n[o];
      (s.f & Zt) !== 0 ? Wh(
        /** @type {Derived} */
        s,
        t,
        !1
      ) : t === s && (r ? At(s, Mt) : (s.f & Rt) !== 0 && At(s, wr), Sc(
        /** @type {Effect} */
        s
      ));
    }
}
function Hh(e) {
  var t = rr, r = lr, n = xr, o = it, s = rn, i = yt, l = Ir, c = jr, u = e.f;
  rr = /** @type {null | Value[]} */
  null, lr = 0, xr = null, it = (u & (kr | mn)) === 0 ? e : null, rn = null, Lo(e.ctx), Ir = !1, jr = ++uo, e.ac !== null && (ns(() => {
    e.ac.abort(Bs);
  }), e.ac = null);
  try {
    e.f |= Hi;
    var d = (
      /** @type {Function} */
      e.fn
    ), f = d();
    e.f |= Qo;
    var h = ed(e);
    if (rs() && xr !== null && !Ir && h !== null && (e.f & (Zt | wr | Mt)) === 0)
      for (var p = 0; p < /** @type {Source[]} */
      xr.length; p++)
        Wh(
          xr[p],
          /** @type {Effect} */
          e
        );
    if (o !== null && o !== e) {
      if (uo++, o.deps !== null)
        for (let v = 0; v < r; v += 1)
          o.deps[v].rv = uo;
      if (t !== null)
        for (const v of t)
          v.rv = uo;
      xr !== null && (n === null ? n = xr : n.push(.../** @type {Source[]} */
      xr));
    }
    return (e.f & Zn) !== 0 && (e.f ^= Zn), f;
  } catch (v) {
    return ed(e), ib(v);
  } finally {
    e.f ^= Hi, rr = t, lr = r, xr = n, it = o, rn = s, Lo(i), Ir = l, jr = c;
  }
}
function ed(e) {
  var t = e.deps, r = Qe?.is_fork;
  if (rr !== null) {
    var n;
    if (r || Cs(e, lr), t !== null && lr > 0)
      for (t.length = lr + rr.length, n = 0; n < rr.length; n++)
        t[lr + n] = rr[n];
    else
      e.deps = t = rr;
    if (zc() && (e.f & Lr) !== 0)
      for (n = lr; n < t.length; n++)
        (t[n].reactions ??= []).push(e);
  } else !r && t !== null && lr < t.length && (Cs(e, lr), t.length = lr);
  return t;
}
function hb(e, t) {
  let r = t.reactions;
  if (r !== null) {
    var n = xm.call(r, e);
    if (n !== -1) {
      var o = r.length - 1;
      o === 0 ? r = t.reactions = null : (r[n] = r[o], r.pop());
    }
  }
  if (r === null && (t.f & Zt) !== 0 && // Destroying a child effect while updating a parent effect can cause a dependency to appear
  // to be unused, when in fact it is used by the currently-updating parent. Checking `new_deps`
  // allows us to skip the expensive work of disconnecting and immediately reconnecting it
  (rr === null || !Ui.call(rr, t))) {
    var s = (
      /** @type {Derived} */
      t
    );
    (s.f & Lr) !== 0 && (s.f ^= Lr), s.v !== Tt && xc(s), s.ac !== null && ns(() => {
      s.ac.abort(Bs), s.ac = null, At(s, Mt);
    }), Jm(s), Cs(s, 0);
  }
}
function Cs(e, t) {
  var r = e.deps;
  if (r !== null)
    for (var n = t; n < r.length; n++)
      hb(e, r[n]);
}
function Fo(e) {
  var t = e.f;
  if ((t & Xt) === 0) {
    At(e, Rt);
    var r = ot, n = Ni;
    ot = e, Ni = (t & (kr | mn)) === 0;
    try {
      (t & (Nr | pc)) !== 0 ? ub(e) : Ec(e), Lh(e);
      var o = Hh(e);
      e.teardown = typeof o == "function" ? o : null, e.wv = Uh;
      var s;
      ih && jm && (e.f & Mt) !== 0 && e.deps;
    } finally {
      Ni = n, ot = r;
    }
  }
}
async function Yi() {
  await Promise.resolve(), eb();
}
function a(e) {
  var t = e.f, r = (t & Zt) !== 0;
  if (it !== null && !Ir) {
    var n = ot !== null && (ot.f & Xt) !== 0;
    if (!n && (rn === null || !rn.has(e))) {
      var o = it.deps;
      if ((it.f & Hi) !== 0)
        e.rv < uo && (e.rv = uo, rr === null && o !== null && o[lr] === e ? lr++ : rr === null ? rr = [e] : rr.push(e));
      else {
        it.deps ??= [], Ui.call(it.deps, e) || it.deps.push(e);
        var s = e.reactions;
        s === null ? e.reactions = [it] : Ui.call(s, it) || s.push(it);
      }
    }
  }
  if (yn && en.has(e))
    return en.get(e);
  if (r) {
    var i = (
      /** @type {Derived} */
      e
    );
    if (yn) {
      var l = i.v;
      return ((i.f & Rt) === 0 && i.reactions !== null || Gh(i)) && (l = wc(i)), en.set(i, l), l;
    }
    var c = (i.f & Lr) === 0 && !Ir && it !== null && (Ni || (it.f & Lr) !== 0), u = (i.f & Qo) === 0;
    Gs(i) && (c && (i.f |= Lr), kh(i)), c && !u && (Sh(i), qh(i));
  }
  if (Pr?.has(e))
    return Pr.get(e);
  if ((e.f & Zn) !== 0)
    throw e.v;
  return e.v;
}
function qh(e) {
  if (e.f |= Lr, e.deps !== null)
    for (const t of e.deps)
      (t.reactions ??= []).push(e), (t.f & Zt) !== 0 && (t.f & Lr) === 0 && (Sh(
        /** @type {Derived} */
        t
      ), qh(
        /** @type {Derived} */
        t
      ));
}
function Gh(e) {
  if (e.v === Tt) return !0;
  if (e.deps === null) return !1;
  for (const t of e.deps)
    if (en.has(t) || (t.f & Zt) !== 0 && Gh(
      /** @type {Derived} */
      t
    ))
      return !0;
  return !1;
}
function Vt(e) {
  var t = Ir;
  try {
    return Ir = !0, e();
  } finally {
    Ir = t;
  }
}
function Kh(e) {
  if (!(typeof e != "object" || !e || e instanceof EventTarget)) {
    if (Qr in e)
      kl(e);
    else if (!Array.isArray(e))
      for (let t in e) {
        const r = e[t];
        typeof r == "object" && r && Qr in r && kl(r);
      }
  }
}
function kl(e, t = /* @__PURE__ */ new Set()) {
  if (typeof e == "object" && e !== null && // We don't want to traverse DOM elements
  !(e instanceof EventTarget) && !t.has(e)) {
    t.add(e), e instanceof Date && e.getTime();
    for (let n in e)
      try {
        kl(e[n], t);
      } catch {
      }
    const r = xa(e);
    if (r !== Object.prototype && r !== Array.prototype && r !== Map.prototype && r !== Set.prototype && r !== Date.prototype) {
      const n = lh(r);
      for (let o in n) {
        const s = n[o].get;
        if (s)
          try {
            s.call(e);
          } catch {
          }
      }
    }
  }
}
const gs = /* @__PURE__ */ Symbol("events"), Yh = /* @__PURE__ */ new Set(), Sl = /* @__PURE__ */ new Set();
function Tc(e, t, r, n = {}) {
  function o(s) {
    if (n.capture || $l.call(t, s), !s.cancelBubble)
      return ns(() => r?.call(this, s));
  }
  return e.startsWith("pointer") || e.startsWith("touch") || e === "wheel" ? (o.__removed = !1, Jr(() => {
    o.__removed || t.addEventListener(e, o, n);
  })) : t.addEventListener(e, o, n), o;
}
function mo(e, t, r, n = {}) {
  var o = Tc(t, e, r, n);
  return () => {
    o.__removed = !0, e.removeEventListener(t, o, n);
  };
}
function jn(e, t, r, n, o) {
  var s = { capture: n, passive: o }, i = Tc(e, t, r, s);
  (t === document.body || // @ts-ignore
  t === window || // @ts-ignore
  t === document || // Firefox has quirky behavior, it can happen that we still get "canplay" events when the element is already removed
  t instanceof HTMLMediaElement) && ya(() => {
    i.__removed = !0, t.removeEventListener(e, i, s);
  });
}
function ht(e, t, r) {
  (t[gs] ??= {})[e] = r;
}
function Lt(e) {
  for (var t = 0; t < e.length; t++)
    Yh.add(e[t]);
  for (var r of Sl)
    r(e);
}
let Za = null, Ua = !1;
function $l(e) {
  var t = this, r = (
    /** @type {Node} */
    t.ownerDocument
  ), n = e.type, o = e.composedPath?.() || [], s = (
    /** @type {null | Element} */
    o[0] || e.target
  );
  Za = e, Ua || (Ua = !0, setTimeout(() => {
    Ua = !1, Za = null;
  }));
  var i = 0, l = Za === e && e[gs];
  if (l) {
    var c = o.indexOf(l);
    if (c !== -1 && (t === document || t === /** @type {any} */
    window)) {
      e[gs] = t;
      return;
    }
    var u = o.indexOf(t);
    if (u === -1)
      return;
    c <= u && (i = c);
  }
  if (s = /** @type {Element} */
  o[i] || e.target, s !== t) {
    ah(e, "currentTarget", {
      configurable: !0,
      get() {
        return s || r;
      }
    });
    var d = it, f = ot;
    Sr(null), on(null);
    try {
      for (var h, p = []; s !== null && s !== t; ) {
        try {
          var v = s[gs]?.[n];
          v != null && (!/** @type {any} */
          s.disabled || // DOM could've been updated already by the time this is reached, so we check this as well
          // -> the target could not have been disabled because it emits the event in the first place
          e.target === s) && v.call(s, e);
        } catch (g) {
          h ? p.push(g) : h = g;
        }
        if (e.cancelBubble) break;
        i++, s = i < o.length ? (
          /** @type {Element} */
          o[i]
        ) : null;
      }
      if (h) {
        for (let g of p)
          queueMicrotask(() => {
            throw g;
          });
        throw h;
      }
    } finally {
      e[gs] = t, delete e.currentTarget, Sr(d), on(f);
    }
  }
}
const pb = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", {
    /** @param {string} html */
    createHTML: (e) => e
  })
);
function vb(e) {
  return (
    /** @type {string} */
    pb?.createHTML(e) ?? e
  );
}
function Xh(e) {
  var t = $c("template");
  return t.innerHTML = vb(e.replaceAll("<!>", "<!---->")), t.content;
}
function bo(e, t) {
  var r = (
    /** @type {Effect} */
    ot
  );
  r.nodes === null && (r.nodes = { start: e, end: t, a: null, t: null });
}
// @__NO_SIDE_EFFECTS__
function z(e, t) {
  var r = (t & 1) !== 0, n = (t & 2) !== 0, o, s = !e.startsWith("<!>");
  return () => {
    o === void 0 && (o = Xh(s ? e : "<!>" + e), r || (o = /** @type {TemplateNode} */
    /* @__PURE__ */ Kr(o)));
    var i = (
      /** @type {TemplateNode} */
      n || Ch ? document.importNode(o, !0) : o.cloneNode(!0)
    );
    if (r) {
      var l = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ Kr(i)
      ), c = (
        /** @type {TemplateNode} */
        i.lastChild
      );
      bo(l, c);
    } else
      bo(i, i);
    return i;
  };
}
// @__NO_SIDE_EFFECTS__
function gb(e, t, r = "svg") {
  var n = !e.startsWith("<!>"), o = (t & 1) !== 0, s = `<${r}>${n ? e : "<!>" + e}</${r}>`, i;
  return () => {
    if (!i) {
      var l = (
        /** @type {DocumentFragment} */
        Xh(s)
      ), c = (
        /** @type {Element} */
        /* @__PURE__ */ Kr(l)
      );
      if (o)
        for (i = document.createDocumentFragment(); /* @__PURE__ */ Kr(c); )
          i.appendChild(
            /** @type {TemplateNode} */
            /* @__PURE__ */ Kr(c)
          );
      else
        i = /** @type {Element} */
        /* @__PURE__ */ Kr(c);
    }
    var u = (
      /** @type {TemplateNode} */
      i.cloneNode(!0)
    );
    if (o) {
      var d = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ Kr(u)
      ), f = (
        /** @type {TemplateNode} */
        u.lastChild
      );
      bo(d, f);
    } else
      bo(u, u);
    return u;
  };
}
// @__NO_SIDE_EFFECTS__
function Yn(e, t) {
  return /* @__PURE__ */ gb(e, t, "svg");
}
function ct(e = "") {
  {
    var t = tn(e + "");
    return bo(t, t), t;
  }
}
function Ze() {
  var e = document.createDocumentFragment(), t = document.createComment(""), r = tn();
  return e.append(t, r), bo(t, r), e;
}
function x(e, t) {
  e !== null && e.before(
    /** @type {Node} */
    t
  );
}
function Zr() {
  return (window.__svelte ??= {}).uid ??= 1, `c${window.__svelte.uid++}`;
}
function mb(e) {
  return e.endsWith("capture") && e !== "gotpointercapture" && e !== "lostpointercapture";
}
const bb = [
  "beforeinput",
  "click",
  "change",
  "dblclick",
  "contextmenu",
  "focusin",
  "focusout",
  "input",
  "keydown",
  "keyup",
  "mousedown",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "pointerdown",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerup",
  "touchend",
  "touchmove",
  "touchstart"
];
function xb(e) {
  return bb.includes(e);
}
const yb = {
  // no `class: 'className'` because we handle that separately
  formnovalidate: "formNoValidate",
  ismap: "isMap",
  nomodule: "noModule",
  playsinline: "playsInline",
  readonly: "readOnly",
  defaultvalue: "defaultValue",
  defaultchecked: "defaultChecked",
  srcobject: "srcObject",
  novalidate: "noValidate",
  allowfullscreen: "allowFullscreen",
  disablepictureinpicture: "disablePictureInPicture",
  disableremoteplayback: "disableRemotePlayback"
};
function _b(e) {
  return e = e.toLowerCase(), yb[e] ?? e;
}
const wb = ["touchstart", "touchmove"];
function kb(e) {
  return wb.includes(e);
}
function Jh(e) {
  let t = 0, r = xn(0), n;
  return () => {
    zc() && (a(r), qs(() => (t === 0 && (n = Vt(() => e(() => cr(r)))), t += 1, () => {
      Jr(() => {
        t -= 1, t === 0 && (n?.(), n = void 0, cr(r));
      });
    })));
  };
}
var Sb = bn | es;
function $b(e, t, r, n) {
  new zb(e, t, r, n);
}
class zb {
  /** @type {Boundary | null} */
  parent;
  is_pending = !1;
  /**
   * API-level transformError transform function. Transforms errors before they reach the `failed` snippet.
   * Inherited from parent boundary, or defaults to identity.
   * @type {(error: unknown) => unknown}
   */
  transform_error;
  /** @type {TemplateNode} */
  #e;
  /** @type {TemplateNode | null} */
  #t = null;
  /** @type {BoundaryProps} */
  #r;
  /** @type {((anchor: Node) => void)} */
  #o;
  /** @type {Effect} */
  #n;
  /** @type {Effect | null} */
  #s = null;
  /** @type {Effect | null} */
  #i = null;
  /** @type {Effect | null} */
  #l = null;
  /** @type {DocumentFragment | null} */
  #a = null;
  #f = 0;
  #c = 0;
  #u = !1;
  /** @type {Set<Effect>} */
  #h = /* @__PURE__ */ new Set();
  /** @type {Set<Effect>} */
  #v = /* @__PURE__ */ new Set();
  /**
   * A source containing the number of pending async deriveds/expressions.
   * Only created if `$effect.pending()` is used inside the boundary,
   * otherwise updating the source results in needless `Batch.ensure()`
   * calls followed by no-op flushes
   * @type {Source<number> | null}
   */
  #d = null;
  #g = Jh(() => (this.#d = xn(this.#f), () => {
    this.#d = null;
  }));
  /**
   * @param {TemplateNode} node
   * @param {BoundaryProps} props
   * @param {((anchor: Node) => void)} children
   * @param {((error: unknown) => unknown) | undefined} [transform_error]
   */
  constructor(t, r, n, o) {
    this.#e = t, this.#r = r, this.#o = (s) => {
      var i = (
        /** @type {Effect} */
        ot
      );
      i.b = this, i.f |= vl, n(s);
    }, this.parent = /** @type {Effect} */
    ot.b, this.transform_error = o ?? this.parent?.transform_error ?? ((s) => s), this.#n = ko(() => {
      this.#_();
    }, Sb);
  }
  #y() {
    try {
      this.#s = tr(() => this.#o(this.#e));
    } catch (t) {
      this.error(t);
    }
  }
  /**
   * @param {unknown} error The deserialized error from the server's hydration comment
   */
  #m(t) {
    const r = this.#r.failed, { reset: n, invoke_onerror: o } = this.#b(t);
    Jr(o), r && (this.#l = tr(() => {
      r(
        this.#e,
        () => t,
        () => n
      );
    }));
  }
  /**
   * Creates the `reset` function for a failed boundary, along with a function
   * that invokes `onerror` with it (if provided)
   * @param {unknown} error
   * @returns {{ reset: () => void, invoke_onerror: () => void }}
   */
  #b(t) {
    var r = !1, n = !1;
    const o = () => {
      if (r) {
        Am();
        return;
      }
      r = !0, n && Lm(), this.#l !== null && ho(this.#l, () => {
        this.#l = null;
      }), this.#w(() => {
        this.#_();
      });
    };
    return { reset: o, invoke_onerror: () => {
      try {
        n = !0, this.#r.onerror?.(t, o), n = !1;
      } catch (i) {
        Yr(i, this.#n && this.#n.parent);
      }
    } };
  }
  #k() {
    const t = this.#r.pending;
    t && (this.is_pending = !0, this.#i = tr(() => t(this.#e)), Jr(() => {
      var r = this.#a = document.createDocumentFragment(), n = tn(), o = !1;
      if (r.append(n), this.#s = this.#w(() => {
        try {
          return tr(() => this.#o(n));
        } catch (s) {
          try {
            this.error(s), o = !0;
          } catch (i) {
            Yr(i, this.#n.parent);
          }
          return null;
        }
      }), this.#s === null) {
        this.#a = null, o && this.#p(
          /** @type {Batch} */
          Qe
        );
        return;
      }
      this.#c === 0 && (this.#e.before(r), this.#a = null, ho(
        /** @type {Effect} */
        this.#i,
        () => {
          this.#i = null;
        }
      ), this.#p(
        /** @type {Batch} */
        Qe
      ));
    }));
  }
  #_() {
    try {
      if (this.is_pending = this.has_pending_snippet(), this.#c = 0, this.#f = 0, this.#s = tr(() => {
        this.#o(this.#e);
      }), this.#c > 0) {
        var t = this.#a = document.createDocumentFragment();
        Mc(this.#s, t);
        const r = (
          /** @type {(anchor: Node) => void} */
          this.#r.pending
        );
        this.#i = tr(() => r(this.#e));
      } else
        this.#p(
          /** @type {Batch} */
          Qe
        );
    } catch (r) {
      this.error(r);
    }
  }
  /**
   * @param {Batch} batch
   */
  #p(t) {
    this.is_pending = !1, t.transfer_effects(this.#h, this.#v);
  }
  /**
   * Defer an effect inside a pending boundary until the boundary resolves
   * @param {Effect} effect
   */
  defer_effect(t) {
    yh(t, this.#h, this.#v);
  }
  /**
   * Returns `false` if the effect exists inside a boundary whose pending snippet is shown
   * @returns {boolean}
   */
  is_rendered() {
    return !this.is_pending && (!this.parent || this.parent.is_rendered());
  }
  has_pending_snippet() {
    return !!this.#r.pending;
  }
  /**
   * @template T
   * @param {() => T} fn
   */
  #w(t) {
    var r = ot, n = it, o = yt;
    on(this.#n), Sr(this.#n), Lo(this.#n.ctx);
    try {
      return Un.ensure(), t();
    } finally {
      on(r), Sr(n), Lo(o);
    }
  }
  /**
   * Updates the pending count associated with the currently visible pending snippet,
   * if any, such that we can replace the snippet with content once work is done
   * @param {1 | -1} d
   * @param {Batch} batch
   */
  #x(t, r) {
    if (!this.has_pending_snippet()) {
      this.parent && this.parent.#x(t, r);
      return;
    }
    this.#c += t, this.#c === 0 && (this.#p(r), this.#i && ho(this.#i, () => {
      this.#i = null;
    }), this.#a && (this.#e.before(this.#a), this.#a = null));
  }
  /**
   * Update the source that powers `$effect.pending()` inside this boundary,
   * and controls when the current `pending` snippet (if any) is removed.
   * Do not call from inside the class
   * @param {1 | -1} d
   * @param {Batch} batch
   */
  update_pending_count(t, r) {
    this.#x(t, r), this.#f += t, !(!this.#d || this.#u) && (this.#u = !0, Jr(() => {
      this.#u = !1, this.#d && Vo(this.#d, this.#f);
    }));
  }
  get_effect_pending() {
    return this.#g(), a(
      /** @type {Source<number>} */
      this.#d
    );
  }
  /** @param {unknown} error */
  error(t) {
    if (!this.#r.onerror && !this.#r.failed)
      throw t;
    Qe?.is_fork ? (this.#s && Qe.skip_effect(this.#s), this.#i && Qe.skip_effect(this.#i), this.#l && Qe.skip_effect(this.#l), Qe.oncommit(() => {
      this.#S(t);
    })) : this.#S(t);
  }
  /**
   * @param {unknown} error
   */
  #S(t) {
    this.#s && (jt(this.#s), this.#s = null), this.#i && (jt(this.#i), this.#i = null), this.#l && (jt(this.#l), this.#l = null);
    let r = this.#r.failed;
    const n = (o) => {
      const { reset: s, invoke_onerror: i } = this.#b(o);
      i(), r && (this.#l = this.#w(() => {
        try {
          return tr(() => {
            var l = (
              /** @type {Effect} */
              ot
            );
            l.b = this, l.f |= vl, r(
              this.#e,
              () => o,
              () => s
            );
          });
        } catch (l) {
          return Yr(
            l,
            /** @type {Effect} */
            this.#n.parent
          ), null;
        }
      }));
    };
    Jr(() => {
      var o;
      try {
        o = this.transform_error(t);
      } catch (s) {
        Yr(s, this.#n && this.#n.parent);
        return;
      }
      o !== null && typeof o == "object" && typeof /** @type {any} */
      o.then == "function" ? o.then(
        n,
        /** @param {unknown} e */
        (s) => Yr(s, this.#n && this.#n.parent)
      ) : n(o);
    });
  }
}
function N(e, t) {
  var r = t == null ? "" : typeof t == "object" ? `${t}` : t;
  r !== /** @type {any} */
  (e[bl] ??= e.nodeValue) && (e[bl] = r, e.nodeValue = `${r}`);
}
function Ab(e, t) {
  return Eb(e, t);
}
const ai = /* @__PURE__ */ new Map();
function Eb(e, { target: t, anchor: r, props: n = {}, events: o, context: s, intro: i = !0, transformError: l }) {
  ob();
  var c = void 0, u = lb(() => {
    var d = r ?? t.appendChild(tn());
    $b(
      /** @type {TemplateNode} */
      d,
      {
        pending: () => {
        }
      },
      (p) => {
        Ee({});
        var v = (
          /** @type {ComponentContext} */
          yt
        );
        s && (v.c = s), o && (n.$$events = o), c = e(p, n) || bc(), Me();
      },
      l
    );
    var f = /* @__PURE__ */ new Set(), h = (p) => {
      for (var v = 0; v < p.length; v++) {
        var g = p[v];
        if (!f.has(g)) {
          f.add(g);
          var y = kb(g);
          for (const S of [t, document]) {
            var _ = ai.get(S);
            _ === void 0 && (_ = /* @__PURE__ */ new Map(), ai.set(S, _));
            var k = _.get(g);
            k === void 0 ? (S.addEventListener(g, $l, { passive: y }), _.set(g, 1)) : _.set(g, k + 1);
          }
        }
      }
    };
    return h(ba(Yh)), Sl.add(h), () => {
      for (var p of f)
        for (const y of [t, document]) {
          var v = (
            /** @type {Map<string, number>} */
            ai.get(y)
          ), g = (
            /** @type {number} */
            v.get(p)
          );
          --g == 0 ? (y.removeEventListener(p, $l), v.delete(p), v.size === 0 && ai.delete(y)) : v.set(p, g);
        }
      Sl.delete(h), d !== r && d.parentNode?.removeChild(d);
    };
  });
  return zl.set(c, u), c;
}
let zl = /* @__PURE__ */ new WeakMap();
function Mb(e, t) {
  const r = zl.get(e);
  return r ? (zl.delete(e), r(t)) : Promise.resolve();
}
class Ks {
  /** @type {TemplateNode} */
  anchor;
  /** @type {Map<Batch, Key>} */
  #e = /* @__PURE__ */ new Map();
  /**
   * Map of keys to effects that are currently rendered in the DOM.
   * These effects are visible and actively part of the document tree.
   * Example:
   * ```
   * {#if condition}
   * 	foo
   * {:else}
   * 	bar
   * {/if}
   * ```
   * Can result in the entries `true->Effect` and `false->Effect`
   * @type {Map<Key, Effect>}
   */
  #t = /* @__PURE__ */ new Map();
  /**
   * Similar to #onscreen with respect to the keys, but contains branches that are not yet
   * in the DOM, because their insertion is deferred.
   * @type {Map<Key, Branch>}
   */
  #r = /* @__PURE__ */ new Map();
  /**
   * Keys of effects that are currently outroing
   * @type {Set<Key>}
   */
  #o = /* @__PURE__ */ new Set();
  /**
   * Whether to pause (i.e. outro) on change, or destroy immediately.
   * This is necessary for `<svelte:element>`
   */
  #n = !0;
  /**
   * @param {TemplateNode} anchor
   * @param {boolean} transition
   */
  constructor(t, r = !0) {
    this.anchor = t, this.#n = r;
  }
  /**
   * @param {Batch} batch
   */
  #s = (t) => {
    if (this.#e.has(t)) {
      var r = (
        /** @type {Key} */
        this.#e.get(t)
      ), n = this.#t.get(r);
      if (n)
        Ki(n), this.#o.delete(r);
      else {
        var o = this.#r.get(r);
        o && (Ki(o.effect), this.#t.set(r, o.effect), this.#r.delete(r), o.fragment.lastChild.remove(), this.anchor.before(o.fragment), n = o.effect);
      }
      for (const [s, i] of this.#e) {
        if (this.#e.delete(s), s === t)
          break;
        const l = this.#r.get(i);
        l && (jt(l.effect), this.#r.delete(i));
      }
      for (const [s, i] of this.#t) {
        if (s === r || this.#o.has(s)) continue;
        const l = () => {
          if (Array.from(this.#e.values()).includes(s)) {
            var u = document.createDocumentFragment();
            Mc(i, u), u.append(tn()), this.#r.set(s, { effect: i, fragment: u });
          } else
            jt(i);
          this.#o.delete(s), this.#t.delete(s);
        };
        this.#n || !n ? (this.#o.add(s), ho(i, l, !1)) : l();
      }
    }
  };
  /**
   * @param {Batch} batch
   */
  #i = (t) => {
    this.#e.delete(t);
    const r = Array.from(this.#e.values());
    for (const [n, o] of this.#r)
      r.includes(n) || (jt(o.effect), this.#r.delete(n));
  };
  /**
   *
   * @param {any} key
   * @param {null | ((target: TemplateNode) => void)} fn
   */
  ensure(t, r) {
    var n = (
      /** @type {Batch} */
      Qe
    ), o = Ph();
    if (r && !this.#t.has(t) && !this.#r.has(t))
      if (o) {
        var s = document.createDocumentFragment(), i = tn();
        s.append(i), this.#r.set(t, {
          effect: tr(() => r(i)),
          fragment: s
        });
      } else
        this.#t.set(
          t,
          tr(() => r(this.anchor))
        );
    if (this.#e.set(n, t), o) {
      for (const [l, c] of this.#t)
        l === t ? n.unskip_effect(c) : n.skip_effect(c);
      for (const [l, c] of this.#r)
        l === t ? n.unskip_effect(c.effect) : n.skip_effect(c.effect);
      n.oncommit(this.#s), n.ondiscard(this.#i);
    } else
      this.#s(n);
  }
}
function vt(e, t, ...r) {
  var n = new Ks(e);
  ko(() => {
    const o = t() ?? null;
    n.ensure(o, o && ((s) => o(s, ...r)));
  }, bn);
}
function os(e) {
  yt === null && bh(), ts && yt.l !== null ? Tb(yt).m.push(e) : _t(() => {
    const t = Vt(e);
    if (typeof t == "function") return (
      /** @type {() => void} */
      t
    );
  });
}
function Tb(e) {
  var t = (
    /** @type {ComponentContextLegacy} */
    e.l
  );
  return t.u ??= { a: [], b: [], m: [] };
}
function Cb() {
  return Symbol(sh);
}
function D(e, t, r = !1) {
  var n = new Ks(e), o = r ? bn : 0;
  function s(i, l) {
    n.ensure(i, l);
  }
  ko(() => {
    var i = !1;
    t((l, c = 0) => {
      i = !0, s(c, l);
    }), i || s(-1, null);
  }, o);
}
const Ob = /* @__PURE__ */ Symbol("NaN");
function Nb(e, t, r) {
  var n = new Ks(e), o = !rs();
  ko(() => {
    var s = t();
    s !== s && (s = /** @type {any} */
    Ob), o && s !== null && typeof s == "object" && (s = /** @type {V} */
    {}), n.ensure(s, r);
  });
}
function xt(e, t) {
  return t;
}
function Pb(e, t, r) {
  for (var n = [], o = t.length, s, i = t.length, l = 0; l < o; l++) {
    let f = t[l];
    ho(
      f,
      () => {
        if (s) {
          if (s.pending.delete(f), s.done.add(f), s.pending.size === 0) {
            var h = (
              /** @type {Set<EachOutroGroup>} */
              e.outrogroups
            );
            Al(e, ba(s.done)), h.delete(s), h.size === 0 && (e.outrogroups = null);
          }
        } else
          i -= 1;
      },
      !1
    );
  }
  if (i === 0) {
    var c = n.length === 0 && r !== null && e.pending.size === 0;
    if (c) {
      var u = (
        /** @type {Element} */
        r
      ), d = (
        /** @type {Element} */
        u.parentNode
      );
      sb(d), d.append(u), e.items.clear();
    }
    Al(e, t, !c);
  } else
    s = {
      pending: new Set(t),
      done: /* @__PURE__ */ new Set()
    }, (e.outrogroups ??= /* @__PURE__ */ new Set()).add(s);
}
function Al(e, t, r = !0) {
  var n;
  if (e.pending.size > 0) {
    n = /* @__PURE__ */ new Set();
    for (const i of e.pending.values())
      for (const l of i)
        n.add(
          /** @type {EachItem} */
          e.items.get(l).e
        );
  }
  for (var o = 0; o < t.length; o++) {
    var s = t[o];
    if (n?.has(s)) {
      s.f |= Xr;
      const i = document.createDocumentFragment();
      Mc(s, i);
    } else
      jt(t[o], r);
  }
}
var td;
function Ae(e, t, r, n, o, s = null) {
  var i = e, l = /* @__PURE__ */ new Map(), c = (t & 4) !== 0;
  if (c) {
    var u = (
      /** @type {Element} */
      e
    );
    i = u.appendChild(tn());
  }
  var d = null, f = /* @__PURE__ */ _c(() => {
    var S = r();
    return (
      /** @type {V[]} */
      Zs(S) ? S : S == null ? [] : ba(S)
    );
  }), h, p = /* @__PURE__ */ new Map(), v = !0;
  function g(S) {
    (k.effect.f & Xt) === 0 && (k.pending.delete(S), k.fallback = d, Ib(k, h, i, t, n), d !== null && (h.length === 0 ? (d.f & Xr) === 0 ? Ki(d) : (d.f ^= Xr, ms(d, null, i)) : ho(d, () => {
      d = null;
    })));
  }
  function y(S) {
    k.pending.delete(S);
  }
  var _ = ko(() => {
    h = /** @type {V[]} */
    a(f);
    for (var S = h.length, b = /* @__PURE__ */ new Set(), $ = (
      /** @type {Batch} */
      Qe
    ), E = Ph(), C = 0; C < S; C += 1) {
      var w = h[C], O = n(w, C), A = v ? null : l.get(O);
      A ? (A.v && Vo(A.v, w), A.i && Vo(A.i, C), E && $.unskip_effect(A.e)) : (A = Rb(
        l,
        v ? i : td ??= tn(),
        w,
        O,
        C,
        o,
        t,
        r
      ), v || (A.e.f |= Xr), l.set(O, A)), b.add(O);
    }
    if (S === 0 && s && !d && (v ? d = tr(() => s(i)) : (d = tr(() => s(td ??= tn())), d.f |= Xr)), S > b.size && Mm(), !v)
      if (p.set($, b), E) {
        for (const [R, W] of l)
          b.has(R) || $.skip_effect(W.e);
        $.oncommit(g), $.ondiscard(y);
      } else
        g($);
    a(f);
  }), k = { effect: _, items: l, pending: p, outrogroups: null, fallback: d };
  v = !1;
}
function as(e) {
  for (; e !== null && (e.f & kr) === 0; )
    e = e.next;
  return e;
}
function Ib(e, t, r, n, o) {
  var s = (n & 8) !== 0, i = t.length, l = e.items, c = as(e.effect.first), u, d = null, f, h = [], p = [], v, g, y, _;
  if (s)
    for (_ = 0; _ < i; _ += 1)
      v = t[_], g = o(v, _), y = /** @type {EachItem} */
      l.get(g).e, (y.f & Xr) === 0 && (y.nodes?.a?.measure(), (f ??= /* @__PURE__ */ new Set()).add(y));
  for (_ = 0; _ < i; _ += 1) {
    if (v = t[_], g = o(v, _), y = /** @type {EachItem} */
    l.get(g).e, e.outrogroups !== null)
      for (const A of e.outrogroups)
        A.pending.delete(y), A.done.delete(y);
    if ((y.f & Yt) !== 0 && (Ki(y), s && (y.nodes?.a?.unfix(), (f ??= /* @__PURE__ */ new Set()).delete(y))), (y.f & Xr) !== 0)
      if (y.f ^= Xr, y === c)
        ms(y, null, r);
      else {
        var k = d ? d.next : c;
        y === e.effect.last && (e.effect.last = y.prev), y.prev && (y.prev.next = y.next), y.next && (y.next.prev = y.prev), Nn(e, d, y), Nn(e, y, k), ms(y, k, r), d = y, h = [], p = [], c = as(d.next);
        continue;
      }
    if (y !== c) {
      if (u !== void 0 && u.has(y)) {
        if (h.length < p.length) {
          var S = p[0], b;
          d = S.prev;
          var $ = h[0], E = h[h.length - 1];
          for (b = 0; b < h.length; b += 1)
            ms(h[b], S, r);
          for (b = 0; b < p.length; b += 1)
            u.delete(p[b]);
          Nn(e, $.prev, E.next), Nn(e, d, $), Nn(e, E, S), c = S, d = E, _ -= 1, h = [], p = [];
        } else
          u.delete(y), ms(y, c, r), Nn(e, y.prev, y.next), Nn(e, y, d === null ? e.effect.first : d.next), Nn(e, d, y), d = y;
        continue;
      }
      for (h = [], p = []; c !== null && c !== y; )
        (u ??= /* @__PURE__ */ new Set()).add(c), p.push(c), c = as(c.next);
      if (c === null)
        continue;
    }
    (y.f & Xr) === 0 && h.push(y), d = y, c = as(y.next);
  }
  if (e.outrogroups !== null) {
    for (const A of e.outrogroups)
      A.pending.size === 0 && (Al(e, ba(A.done)), e.outrogroups?.delete(A));
    e.outrogroups.size === 0 && (e.outrogroups = null);
  }
  if (c !== null || u !== void 0) {
    var C = [];
    if (u !== void 0)
      for (y of u)
        (y.f & Yt) === 0 && C.push(y);
    for (; c !== null; )
      (c.f & Yt) === 0 && c !== e.fallback && C.push(c), c = as(c.next);
    var w = C.length;
    if (w > 0) {
      var O = (n & 4) !== 0 && i === 0 ? r : null;
      if (s) {
        for (_ = 0; _ < w; _ += 1)
          C[_].nodes?.a?.measure();
        for (_ = 0; _ < w; _ += 1)
          C[_].nodes?.a?.fix();
      }
      Pb(e, C, O);
    }
  }
  s && Jr(() => {
    if (f !== void 0)
      for (y of f)
        y.nodes?.a?.apply();
  });
}
function Rb(e, t, r, n, o, s, i, l) {
  var c = (i & 1) !== 0 ? (i & 16) === 0 ? /* @__PURE__ */ rb(r, !1, !1) : xn(r) : null, u = (i & 2) !== 0 ? xn(o) : null;
  return {
    v: c,
    i: u,
    e: tr(() => (s(t, c ?? r, u ?? o, l), () => {
      e.delete(n);
    }))
  };
}
function ms(e, t, r) {
  if (e.nodes)
    for (var n = e.nodes.start, o = e.nodes.end, s = t && (t.f & Xr) === 0 ? (
      /** @type {EffectNodes} */
      t.nodes.start
    ) : r; n !== null; ) {
      var i = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ Hs(n)
      );
      if (s.before(n), n === o)
        return;
      n = i;
    }
}
function Nn(e, t, r) {
  t === null ? e.effect.first = r : t.next = r, r === null ? e.effect.last = t : r.prev = t;
}
function It(e, t, r) {
  var n = new Ks(e);
  ko(() => {
    var o = t() ?? null;
    n.ensure(o, o && ((s) => r(s, o)));
  }, bn);
}
function Qh(e, t, r, n, o, s) {
  var i = null, l = (
    /** @type {TemplateNode} */
    e
  ), c = new Ks(l, !1);
  ko(() => {
    const u = t() || null;
    var d = r || u === "svg" ? bm : void 0;
    if (u === null) {
      c.ensure(null, null);
      return;
    }
    return c.ensure(u, (f) => {
      if (u) {
        if (i = $c(u, d), bo(i, i), n) {
          var h = null, p = i.appendChild(tn());
          n(i, p), h?.remove();
        }
        ot.nodes.end = i, f.before(i);
      }
    }), () => {
    };
  }, bn), ya(() => {
  });
}
function Db(e, t) {
  wo(() => {
    e = ot?.parent?.nodes?.start ?? e;
    var r = e.getRootNode(), n = (
      /** @type {ShadowRoot} */
      r.host ? (
        /** @type {ShadowRoot} */
        r
      ) : (
        /** @type {Document} */
        r.head ?? /** @type {Document} */
        r.ownerDocument.head
      )
    );
    if (!n.querySelector("#" + t.hash)) {
      const o = $c("style");
      o.id = t.hash, o.textContent = t.code, n.appendChild(o);
    }
  });
}
function Lb(e, t, r) {
  wo(() => {
    var n = Vt(() => t(e, r?.()) || {});
    if (r && n?.update) {
      var o = !1, s = (
        /** @type {any} */
        {}
      );
      qs(() => {
        var i = r();
        Kh(i), o && gh(s, i) && (s = i, n.update(i));
      }), o = !0;
    }
    if (n?.destroy)
      return () => (
        /** @type {Function} */
        n.destroy()
      );
  });
}
function jb(e, t) {
  var r = void 0, n;
  Dh(() => {
    r !== (r = t()) && (n && (jt(n), n = null), r && (n = tr(() => {
      wo(() => (
        /** @type {(node: Element) => void} */
        r(e)
      ));
    })));
  });
}
function ep(e) {
  var t, r, n = "";
  if (typeof e == "string" || typeof e == "number") n += e;
  else if (typeof e == "object") if (Array.isArray(e)) {
    var o = e.length;
    for (t = 0; t < o; t++) e[t] && (r = ep(e[t])) && (n && (n += " "), n += r);
  } else for (r in e) e[r] && (n && (n += " "), n += r);
  return n;
}
function $s() {
  for (var e, t, r = 0, n = "", o = arguments.length; r < o; r++) (e = arguments[r]) && (t = ep(e)) && (n && (n += " "), n += t);
  return n;
}
function Zo(e) {
  return typeof e == "object" ? $s(e) : e ?? "";
}
const rd = [...` 	
\r\f \v\uFEFF`];
function Vb(e, t, r) {
  var n = e == null ? "" : "" + e;
  if (r) {
    for (var o of Object.keys(r))
      if (r[o])
        n = n ? n + " " + o : o;
      else if (n.length)
        for (var s = o.length, i = 0; (i = n.indexOf(o, i)) >= 0; ) {
          var l = i + s;
          (i === 0 || rd.includes(n[i - 1])) && (l === n.length || rd.includes(n[l])) ? n = (i === 0 ? "" : n.substring(0, i)) + n.substring(l + 1) : i = l;
        }
  }
  return n === "" ? null : n;
}
function nd(e, t = !1) {
  var r = t ? " !important;" : ";", n = "";
  for (var o of Object.keys(e)) {
    var s = e[o];
    s != null && s !== "" && (n += " " + o + ": " + s + r);
  }
  return n;
}
function Ba(e) {
  return e[0] !== "-" || e[1] !== "-" ? e.toLowerCase() : e;
}
function Fb(e, t) {
  if (t) {
    var r = "", n, o;
    if (Array.isArray(t) ? (n = t[0], o = t[1]) : n = t, e) {
      e = String(e).replaceAll(/\/\*.*?\*\//g, "").trim();
      var s = !1, i = 0, l = !1, c = [];
      n && c.push(...Object.keys(n).map(Ba)), o && c.push(...Object.keys(o).map(Ba));
      var u = 0, d = -1;
      const g = e.length;
      for (var f = 0; f < g; f++) {
        var h = e[f];
        if (l ? h === "/" && e[f - 1] === "*" && (l = !1) : s ? s === h && (s = !1) : h === "/" && e[f + 1] === "*" ? l = !0 : h === '"' || h === "'" ? s = h : h === "(" ? i++ : h === ")" && i--, !l && s === !1 && i === 0) {
          if (h === ":" && d === -1)
            d = f;
          else if (h === ";" || f === g - 1) {
            if (d !== -1) {
              var p = Ba(e.substring(u, d).trim());
              if (!c.includes(p)) {
                h !== ";" && f++;
                var v = e.substring(u, f).trim();
                r += " " + v + ";";
              }
            }
            u = f + 1, d = -1;
          }
        }
      }
    }
    return n && (r += nd(n)), o && (r += nd(o, !0)), r = r.trim(), r === "" ? null : r;
  }
  return e == null ? null : String(e);
}
function Ye(e, t, r, n, o, s) {
  var i = (
    /** @type {any} */
    e[gl]
  );
  if (i !== r || i === void 0) {
    var l = Vb(r, n, s);
    l == null ? e.removeAttribute("class") : t ? e.className = l : e.setAttribute("class", l), e[gl] = r;
  } else if (s && o !== s)
    for (var c in s) {
      var u = !!s[c];
      (o == null || u !== !!o[c]) && e.classList.toggle(c, u);
    }
  return s;
}
function Wa(e, t = {}, r, n) {
  for (var o in r) {
    var s = r[o];
    t[o] !== s && (r[o] == null ? e.style.removeProperty(o) : e.style.setProperty(o, s, n));
  }
}
function Ln(e, t, r, n) {
  var o = (
    /** @type {any} */
    e[ml]
  );
  if (o !== t) {
    var s = Fb(t, n);
    s == null ? e.removeAttribute("style") : e.style.cssText = s, e[ml] = t;
  } else n && (Array.isArray(n) ? (Wa(e, r?.[0], n[0]), Wa(e, r?.[1], n[1], "important")) : Wa(e, r, n));
  return n;
}
function tp(e, t) {
  t ? e.hasAttribute("selected") || e.setAttribute("selected", "") : e.removeAttribute("selected");
}
function od(e, t) {
  var r = !("__defaultValue" in e);
  !r && e.__defaultValue === t || (e.__defaultValue = t, rp(e, !r || "__value" in e));
}
function rp(e, t) {
  var r = e.__defaultValue, n = e.multiple, o = n ? r ?? [] : null;
  if (!(n && !Zs(o))) {
    var s = e.selectedIndex, i = t && n ? new Set(e.selectedOptions) : null;
    for (var l of e.options) {
      var c = No(l);
      tp(
        l,
        n ? (
          /** @type {any[]} */
          o.includes(c)
        ) : Th(c, r)
      );
    }
    if (t)
      if (i !== null)
        for (l of e.options) {
          var u = i.has(l);
          l.selected !== u && (l.selected = u);
        }
      else e.selectedIndex !== s && (e.selectedIndex = s);
  }
}
function Xi(e, t, r = !1) {
  if (e.multiple) {
    if (t == null)
      return;
    if (!Zs(t))
      return zm();
    for (var n of e.options)
      n.selected = t.includes(No(n));
    return;
  }
  for (n of e.options) {
    var o = No(n);
    if (Th(o, t)) {
      n.selected = !0;
      return;
    }
  }
  (!r || t !== void 0) && (e.selectedIndex = -1);
}
function zs(e) {
  var t = new MutationObserver((r) => {
    r.every(Zb) || ("__defaultValue" in e && rp(e, !1), "__value" in e && Xi(e, e.__value));
  });
  t.observe(e, {
    // Listen to option element changes
    childList: !0,
    subtree: !0,
    // because of <optgroup>
    // Listen to option element value attribute changes
    // (doesn't get notified of select value changes,
    // because that property is not reflected as an attribute)
    attributes: !0,
    attributeFilter: ["value"]
  }), ya(() => {
    t.disconnect();
  });
}
function Pi(e, t, r = t) {
  var n = /* @__PURE__ */ new WeakSet(), o = !0;
  yc(e, "change", (s) => {
    var i = s ? "[selected]" : ":checked", l;
    if (e.multiple)
      l = [].map.call(e.querySelectorAll(i), No);
    else {
      var c = e.querySelector(i) ?? // will fall back to first non-disabled option if no option is selected
      e.querySelector("option:not([disabled])");
      l = c && No(c);
    }
    r(l), e.__value = l, Qe !== null && n.add(Qe);
  }), wo(() => {
    var s = t();
    if (e === document.activeElement) {
      var i = (
        /** @type {Batch} */
        Qe
      );
      if (n.has(i))
        return;
    }
    if (Xi(e, s, o), o && s === void 0) {
      var l = e.querySelector(":checked");
      l !== null && (s = No(l), r(s));
    }
    e.__value = s, o = !1;
  });
}
function No(e) {
  return "__value" in e ? e.__value : e.value;
}
function Zb(e) {
  if (
    /** @type {Element} */
    e.target.closest("selectedcontent") !== null
  )
    return !0;
  if (e.type === "childList") {
    var t = [...e.addedNodes, ...e.removedNodes];
    return t.length > 0 && t.every((r) => r.nodeName === "SELECTEDCONTENT");
  }
  return !1;
}
const ls = /* @__PURE__ */ Symbol("class"), cs = /* @__PURE__ */ Symbol("style"), np = /* @__PURE__ */ Symbol("is custom element"), op = /* @__PURE__ */ Symbol("is html"), Ub = gc ? "input" : "INPUT", Bb = gc ? "option" : "OPTION", sp = gc ? "select" : "SELECT";
function $e(e, t, r, n) {
  var o = ip(e);
  o[t] !== (o[t] = r) && (t === "loading" && (e[Sm] = r), r == null ? e.removeAttribute(t) : typeof r != "string" && ap(e).has(t) ? e[t] = r : e.setAttribute(t, r));
}
function Wb(e, t, r, n, o = !1, s = !1) {
  var i = ip(e), l = i[np], c = !i[op], u = t || {}, d = e.nodeName === Bb, f = e.nodeName === sp;
  for (var h in t)
    !(h in r) && h[0] + h[1] !== "$$" && (r[h] = null);
  r.class ? r.class = Zo(r.class) : r[ls] && (r.class = null), r[cs] && (r.style ??= null);
  var p = ap(e);
  if (e.nodeName === Ub && "type" in r && ("value" in r || "__value" in r)) {
    var v = r.type;
    (v !== u.type || v === void 0 && e.hasAttribute("type")) && (u.type = v, $e(e, "type", v));
  }
  for (const $ in r) {
    let E = r[$];
    if (d && $ === "value" && E == null) {
      e.value = e.__value = "", u[$] = E;
      continue;
    }
    if ($ === "class") {
      var g = e.namespaceURI === "http://www.w3.org/1999/xhtml";
      Ye(e, g, E, n, t?.[ls], r[ls]), u[$] = E, u[ls] = r[ls];
      continue;
    }
    if ($ === "style") {
      Ln(e, E, t?.[cs], r[cs]), u[$] = E, u[cs] = r[cs];
      continue;
    }
    var y = u[$];
    if (!(E === y && !(E === void 0 && e.hasAttribute($)))) {
      u[$] = E;
      var _ = $[0] + $[1];
      if (_ !== "$$")
        if (_ === "on") {
          const C = {}, w = "$$" + $;
          let O = $.slice(2);
          var k = xb(O);
          if (mb(O) && (O = O.slice(0, -7), C.capture = !0), !k && y) {
            if (E != null) continue;
            e.removeEventListener(O, u[w], C), u[w] = null;
          }
          if (k)
            ht(O, e, E), Lt([O]);
          else if (E != null) {
            let A = function(R) {
              u[$].call(this, R);
            };
            u[w] = Tc(O, e, A, C);
          }
        } else if ($ === "style")
          $e(e, $, E);
        else if ($ === "autofocus")
          qm(
            /** @type {HTMLElement} */
            e,
            !!E
          );
        else if (!l && ($ === "__value" || $ === "value" && E != null))
          e.value = e.__value = E;
        else if ($ === "selected" && d)
          tp(
            /** @type {HTMLOptionElement} */
            e,
            E
          );
        else {
          var S = $;
          c || (S = _b(S));
          var b = S === "defaultValue" || S === "defaultChecked";
          if (f && S === "defaultValue") continue;
          if (E == null && !l && !b)
            if (i[$] = null, S === "value" || S === "checked") {
              let C = (
                /** @type {HTMLInputElement} */
                e
              );
              const w = t === void 0;
              if (S === "value") {
                let O = C.defaultValue;
                C.removeAttribute(S), C.defaultValue = O, C.value = C.__value = w ? O : null;
              } else {
                let O = C.defaultChecked;
                C.removeAttribute(S), C.defaultChecked = O, C.checked = w ? O : !1;
              }
            } else
              e.removeAttribute($);
          else b || (l || typeof E != "string") && p.has(S) ? (e[S] = E, S in i && (i[S] = Tt)) : typeof E != "function" && $e(e, S, E);
        }
    }
  }
  return u;
}
function Et(e, t, r = [], n = [], o = [], s, i = !1, l = !1) {
  _h(o, r, n, (c) => {
    var u = void 0, d = {}, f = e.nodeName === sp, h = !1;
    if (Dh(() => {
      var v = t(...c.map(a)), g = Wb(
        e,
        u,
        v,
        s,
        i,
        l
      );
      if (h && f) {
        var y = (
          /** @type {HTMLSelectElement} */
          e
        );
        "defaultValue" in v && od(y, v.defaultValue), "value" in v && Xi(y, v.value);
      }
      for (let k of Object.getOwnPropertySymbols(d))
        v[k] || jt(d[k]);
      for (let k of Object.getOwnPropertySymbols(v)) {
        var _ = v[k];
        k.description === sh && (!u || _ !== u[k]) && (d[k] && jt(d[k]), d[k] = tr(() => jb(e, () => _))), g[k] = _;
      }
      u = g;
    }), f) {
      var p = (
        /** @type {HTMLSelectElement} */
        e
      );
      wo(() => {
        var v = (
          /** @type {Record<string | symbol, any>} */
          u
        );
        "defaultValue" in v && od(p, v.defaultValue), Xi(p, v.value, !0), zs(p);
      });
    }
    h = !0;
  });
}
function ip(e) {
  return (
    /** @type {Record<string | symbol, unknown>} **/
    /** @type {any} */
    e[ph] ??= {
      [np]: e.nodeName.includes("-"),
      [op]: e.namespaceURI === oh
    }
  );
}
var sd = /* @__PURE__ */ new Map();
function ap(e) {
  var t = e.getAttribute("is") || e.nodeName, r = sd.get(t);
  if (r) return r;
  sd.set(t, r = /* @__PURE__ */ new Set());
  for (var n, o = e, s = Element.prototype; s !== o; ) {
    n = lh(o);
    for (var i in n)
      n[i].set && // better safe than sorry, we don't want spread attributes to mess with HTML content
      i !== "innerHTML" && i !== "textContent" && i !== "innerText" && r.add(i);
    o = xa(o);
  }
  return r;
}
function Uo(e, t, r = t) {
  var n = /* @__PURE__ */ new WeakSet();
  yc(e, "input", async (o) => {
    var s = o ? e.defaultValue : e.value;
    if (s = Ha(e) ? qa(s) : s, r(s), Qe !== null && n.add(Qe), await Yi(), s !== (s = t())) {
      var i = e.selectionStart, l = e.selectionEnd, c = e.value.length;
      if (e.value = s ?? "", l !== null) {
        var u = e.value.length;
        i === l && l === c && u > c ? (e.selectionStart = u, e.selectionEnd = u) : (e.selectionStart = i, e.selectionEnd = Math.min(l, u));
      }
    }
  }), // If we are hydrating and the value has since changed,
  // then use the updated value from the input instead.
  // If defaultValue is set, then value == defaultValue
  // TODO Svelte 6: remove input.value check and set to empty string?
  Vt(t) == null && e.value && (r(Ha(e) ? qa(e.value) : e.value), Qe !== null && n.add(Qe)), qs(() => {
    var o = t();
    if (e === document.activeElement) {
      var s = (
        /** @type {Batch} */
        Qe
      );
      if (n.has(s))
        return;
    }
    Ha(e) && o === qa(e.value) || e.type === "date" && !o && !e.value || o !== e.value && (e.value = o ?? "");
  });
}
function Ha(e) {
  var t = e.type;
  return t === "number" || t === "range";
}
function qa(e) {
  return e === "" ? null : +e;
}
function Hb(e, t, r = t) {
  yc(e, "change", () => {
    r(e.files);
  }), qs(() => {
    e.files = t();
  });
}
class Cc {
  /** */
  #e = /* @__PURE__ */ new WeakMap();
  /** @type {ResizeObserver | undefined} */
  #t;
  /** @type {ResizeObserverOptions} */
  #r;
  /** @static */
  static entries = /* @__PURE__ */ new WeakMap();
  /** @param {ResizeObserverOptions} options */
  constructor(t) {
    this.#r = t;
  }
  /**
   * @param {Element} element
   * @param {(entry: ResizeObserverEntry) => any} listener
   */
  observe(t, r) {
    var n = this.#e.get(t) || /* @__PURE__ */ new Set();
    return n.add(r), this.#e.set(t, n), this.#o().observe(t, this.#r), () => {
      var o = this.#e.get(t);
      o.delete(r), o.size === 0 && (this.#e.delete(t), this.#t.unobserve(t));
    };
  }
  #o() {
    return this.#t ?? (this.#t = new ResizeObserver(
      /** @param {any} entries */
      (t) => {
        for (var r of t) {
          Cc.entries.set(r.target, r);
          for (var n of this.#e.get(r.target) || [])
            n(r);
        }
      }
    ));
  }
}
var qb = /* @__PURE__ */ new Cc({
  box: "border-box"
});
function id(e, t, r) {
  var n = qb.observe(e, () => r(e[t]));
  wo(() => (Vt(() => r(e[t])), n));
}
function Ga(e, t) {
  return e === t || e?.[Qr] === t;
}
function _n(e = bc(), t, r, n) {
  var o = (
    /** @type {ComponentContext} */
    yt.r
  ), s = (
    /** @type {Effect} */
    ot
  );
  return wo(() => {
    var i, l;
    return qs(() => {
      i = l, l = [], Vt(() => {
        Ga(r(...l), e) || (t(e, ...l), i && Ga(r(...i), e) && t(null, ...i));
      });
    }), () => {
      let c = s;
      for (; c !== o && c.parent !== null && c.parent.f & Bi; )
        c = c.parent;
      const u = () => {
        l && Ga(r(...l), e) && t(null, ...l);
      }, d = c.teardown;
      c.teardown = () => {
        u(), d?.();
      };
    };
  }), e;
}
function Gb(e = !1) {
  const t = (
    /** @type {ComponentContextLegacy} */
    yt
  ), r = t.l.u;
  if (!r) return;
  let n = () => Kh(t.s);
  if (e) {
    let o = 0, s = (
      /** @type {Record<string, any>} */
      {}
    );
    const i = /* @__PURE__ */ jo(() => {
      let l = !1;
      const c = t.s;
      for (const u in c)
        c[u] !== s[u] && (s[u] = c[u], l = !0);
      return l && o++, o;
    });
    n = () => a(i);
  }
  r.b.length && Ac(() => {
    ad(t, n), pl(r.b);
  }), _t(() => {
    const o = Vt(() => r.m.map(_m));
    return () => {
      for (const s of o)
        typeof s == "function" && s();
    };
  }), r.a.length && _t(() => {
    ad(t, n), pl(r.a);
  });
}
function ad(e, t) {
  if (e.l.s)
    for (const r of e.l.s) a(r);
  t();
}
let li = !1;
function Kb(e) {
  var t = li;
  try {
    return li = !1, [e(), li];
  } finally {
    li = t;
  }
}
const Yb = {
  get(e, t) {
    if (!e.exclude.has(t))
      return e.props[t];
  },
  set(e, t) {
    return !1;
  },
  getOwnPropertyDescriptor(e, t) {
    if (!e.exclude.has(t) && t in e.props)
      return {
        enumerable: !0,
        configurable: !0,
        value: e.props[t]
      };
  },
  has(e, t) {
    return e.exclude.has(t) ? !1 : t in e.props;
  },
  ownKeys(e) {
    return Reflect.ownKeys(e.props).filter((t) => !e.exclude.has(t));
  }
};
// @__NO_SIDE_EFFECTS__
function K(e, t, r) {
  return new Proxy({ props: e, exclude: t }, Yb);
}
const Xb = {
  get(e, t) {
    let r = e.props.length;
    for (; r--; ) {
      let n = e.props[r];
      if (is(n) && (n = n()), typeof n == "object" && n !== null && t in n) return n[t];
    }
  },
  set(e, t, r) {
    let n = e.props.length;
    for (; n--; ) {
      let o = e.props[n];
      is(o) && (o = o());
      const s = Fn(o, t);
      if (s && s.set)
        return s.set(r), !0;
    }
    return !1;
  },
  getOwnPropertyDescriptor(e, t) {
    let r = e.props.length;
    for (; r--; ) {
      let n = e.props[r];
      if (is(n) && (n = n()), typeof n == "object" && n !== null && t in n) {
        const o = Fn(n, t);
        return o && !o.configurable && (o.configurable = !0), o;
      }
    }
  },
  has(e, t) {
    if (t === Qr || t === hh) return !1;
    for (let r of e.props)
      if (is(r) && (r = r()), r != null && t in r) return !0;
    return !1;
  },
  ownKeys(e) {
    const t = [];
    for (let r of e.props)
      if (is(r) && (r = r()), !!r) {
        for (const n in r)
          t.includes(n) || t.push(n);
        for (const n of Object.getOwnPropertySymbols(r))
          t.includes(n) || t.push(n);
      }
    return t;
  }
};
function J(...e) {
  return new Proxy({ props: e }, Xb);
}
function be(e, t, r, n) {
  var o = !ts || (r & 2) !== 0, s = (r & 8) !== 0, i = (r & 16) !== 0, l = (
    /** @type {V} */
    n
  ), c = !0, u = (
    /** @type {Derived<V> | undefined} */
    void 0
  ), d = () => i && o ? (u ??= /* @__PURE__ */ jo(
    /** @type {() => V} */
    n
  ), a(u)) : (c && (c = !1, l = i ? Vt(
    /** @type {() => V} */
    n
  ) : (
    /** @type {V} */
    n
  )), l);
  let f;
  if (s) {
    var h = Qr in e || hh in e;
    f = Fn(e, t)?.set ?? (h && t in e ? (b) => e[t] = b : void 0);
  }
  var p, v = !1;
  s ? [p, v] = Kb(() => (
    /** @type {V} */
    e[t]
  )) : p = /** @type {V} */
  e[t], p === void 0 && n !== void 0 && (p = d(), f && (o && Pm(), f(p)));
  var g;
  if (o ? g = () => {
    var b = (
      /** @type {V} */
      e[t]
    );
    return b === void 0 ? d() : (c = !0, b);
  } : g = () => {
    var b = (
      /** @type {V} */
      e[t]
    );
    return b !== void 0 && (l = /** @type {V} */
    void 0), b === void 0 ? l : b;
  }, o && (r & 4) === 0)
    return g;
  if (f) {
    var y = e.$$legacy;
    return (
      /** @type {() => V} */
      (function(b, $) {
        return arguments.length > 0 ? ((!o || !$ || y || v) && f($ ? g() : b), b) : g();
      })
    );
  }
  var _ = !1, k = ((r & 1) !== 0 ? jo : _c)(() => (_ = !1, g()));
  s && a(k);
  var S = (
    /** @type {Effect} */
    ot
  );
  return (
    /** @type {() => V} */
    (function(b, $) {
      if (arguments.length > 0) {
        const E = $ ? a(k) : o && s ? Gt(b) : b;
        return Z(k, E), _ = !0, l !== void 0 && (l = E), b;
      }
      return yn && _ || (S.f & Xt) !== 0 ? k.v : a(k);
    })
  );
}
const Jb = `@layer properties{@supports (display:block){*,:before,:after,::backdrop{--tw-translate-x:0;--tw-translate-y:0;--tw-translate-z:0;--tw-rotate-x:initial;--tw-rotate-y:initial;--tw-rotate-z:initial;--tw-skew-x:initial;--tw-skew-y:initial;--tw-divide-y-reverse:0;--tw-border-style:solid;--tw-leading:initial;--tw-font-weight:initial;--tw-tracking:initial;--tw-ordinal:initial;--tw-slashed-zero:initial;--tw-numeric-figure:initial;--tw-numeric-spacing:initial;--tw-numeric-fraction:initial;--tw-shadow:0 0 #0000;--tw-shadow-color:initial;--tw-shadow-alpha:100%;--tw-inset-shadow:0 0 #0000;--tw-inset-shadow-color:initial;--tw-inset-shadow-alpha:100%;--tw-ring-color:initial;--tw-ring-shadow:0 0 #0000;--tw-inset-ring-color:initial;--tw-inset-ring-shadow:0 0 #0000;--tw-ring-inset:initial;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-offset-shadow:0 0 #0000;--tw-outline-style:solid;--tw-blur:initial;--tw-brightness:initial;--tw-contrast:initial;--tw-grayscale:initial;--tw-hue-rotate:initial;--tw-invert:initial;--tw-opacity:initial;--tw-saturate:initial;--tw-sepia:initial;--tw-drop-shadow:initial;--tw-drop-shadow-color:initial;--tw-drop-shadow-alpha:100%;--tw-drop-shadow-size:initial;--tw-content:"";--tw-animation-delay:0s;--tw-animation-direction:normal;--tw-animation-duration:initial;--tw-animation-fill-mode:none;--tw-animation-iteration-count:1;--tw-enter-blur:0;--tw-enter-opacity:1;--tw-enter-rotate:0;--tw-enter-scale:1;--tw-enter-translate-x:0;--tw-enter-translate-y:0;--tw-exit-blur:0;--tw-exit-opacity:1;--tw-exit-rotate:0;--tw-exit-scale:1;--tw-exit-translate-x:0;--tw-exit-translate-y:0}}}@layer theme{:root,:host{--font-sans:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";--font-serif:"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;--font-mono:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;--color-red-300:oklch(80.8% .114 19.571);--color-amber-200:oklch(92.4% .12 95.746);--color-amber-300:oklch(87.9% .169 91.605);--color-amber-400:oklch(82.8% .189 84.429);--color-amber-500:oklch(76.9% .188 70.08);--color-amber-600:oklch(66.6% .179 58.318);--color-amber-700:oklch(55.5% .163 48.998);--color-amber-800:oklch(47.3% .137 46.201);--color-amber-900:oklch(41.4% .112 45.904);--color-emerald-300:oklch(84.5% .143 164.978);--color-emerald-400:oklch(76.5% .177 163.223);--color-emerald-600:oklch(59.6% .145 163.225);--color-emerald-700:oklch(50.8% .118 165.612);--color-emerald-800:oklch(43.2% .095 166.913);--color-sky-300:oklch(82.8% .111 230.318);--color-sky-600:oklch(58.8% .158 241.966);--color-sky-800:oklch(44.3% .11 240.79);--color-black:#000;--color-white:#fff;--spacing:.25rem;--container-xs:20rem;--container-lg:32rem;--container-xl:36rem;--container-4xl:56rem;--container-5xl:64rem;--text-xs:.75rem;--text-xs--line-height:calc(1 / .75);--text-sm:.875rem;--text-sm--line-height:calc(1.25 / .875);--text-base:1rem;--text-base--line-height: 1.5 ;--text-lg:1.125rem;--text-lg--line-height:calc(1.75 / 1.125);--text-xl:1.25rem;--text-xl--line-height:calc(1.75 / 1.25);--text-2xl:1.5rem;--text-2xl--line-height:calc(2 / 1.5);--text-4xl:2.25rem;--text-4xl--line-height:calc(2.5 / 2.25);--font-weight-normal:400;--font-weight-medium:500;--font-weight-semibold:600;--tracking-wide:.025em;--leading-tight:1.25;--leading-snug:1.375;--leading-relaxed:1.625;--radius-md:calc(var(--radius) - 2px);--radius-4xl:2rem;--animate-spin:spin 1s linear infinite;--animate-pulse:pulse 2s cubic-bezier(.4, 0, .6, 1) infinite;--default-transition-duration:.15s;--default-transition-timing-function:cubic-bezier(.4, 0, .2, 1);--default-font-family:var(--font-sans);--default-mono-font-family:var(--font-mono)}}@layer base{*,:after,:before,::backdrop{box-sizing:border-box;border:0 solid;margin:0;padding:0}::file-selector-button{box-sizing:border-box;border:0 solid;margin:0;padding:0}html,:host{-webkit-text-size-adjust:100%;tab-size:4;line-height:1.5;font-family:var(--default-font-family,-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji");font-feature-settings:var(--default-font-feature-settings,normal);font-variation-settings:var(--default-font-variation-settings,normal);-webkit-tap-highlight-color:transparent}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;-webkit-text-decoration:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,samp,pre{font-family:var(--default-mono-font-family,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);font-feature-settings:var(--default-mono-font-feature-settings,normal);font-variation-settings:var(--default-mono-font-variation-settings,normal);font-size:1em}small{font-size:80%}sub,sup{vertical-align:baseline;font-size:75%;line-height:0;position:relative}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}:-moz-focusring:where(:not(iframe)){outline:auto}progress{vertical-align:baseline}summary{display:list-item}ol,ul,menu{list-style:none}img,svg,video,canvas,audio,iframe,embed,object{vertical-align:middle;display:block}img,video{max-width:100%;height:auto}button,input,select,optgroup,textarea{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}::file-selector-button{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}:where(select:is([multiple],[size])) optgroup{font-weight:bolder}:where(select:is([multiple],[size])) optgroup option{padding-inline-start:20px}::file-selector-button{margin-inline-end:4px}::placeholder{opacity:1}@supports (not ((-webkit-appearance:-apple-pay-button))) or (contain-intrinsic-size:1px){::placeholder{color:currentColor}@supports (color:color-mix(in lab,red,red)){::placeholder{color:color-mix(in oklab,currentcolor 50%,transparent)}}}textarea{resize:vertical}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-date-and-time-value{min-height:1lh;text-align:inherit}::-webkit-datetime-edit{display:inline-flex}::-webkit-datetime-edit-fields-wrapper{padding:0}::-webkit-datetime-edit{padding-block:0}::-webkit-datetime-edit-year-field{padding-block:0}::-webkit-datetime-edit-month-field{padding-block:0}::-webkit-datetime-edit-day-field{padding-block:0}::-webkit-datetime-edit-hour-field{padding-block:0}::-webkit-datetime-edit-minute-field{padding-block:0}::-webkit-datetime-edit-second-field{padding-block:0}::-webkit-datetime-edit-millisecond-field{padding-block:0}::-webkit-datetime-edit-meridiem-field{padding-block:0}::-webkit-calendar-picker-indicator{line-height:1}:-moz-ui-invalid{box-shadow:none}button,input:where([type=button],[type=reset],[type=submit]){appearance:button}::file-selector-button{appearance:button}::-webkit-inner-spin-button{height:auto}::-webkit-outer-spin-button{height:auto}[hidden]:where(:not([hidden=until-found])){display:none!important}*{border-color:var(--border);outline-color:var(--ring)}@supports (color:color-mix(in lab,red,red)){*{outline-color:color-mix(in oklab,var(--ring) 50%,transparent)}}}@layer components;@layer utilities{.pointer-events-none{pointer-events:none}.visible{visibility:visible}.sr-only{clip-path:inset(50%);white-space:nowrap;border-width:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.absolute{position:absolute}.relative{position:relative}.static{position:static}.sticky{position:sticky}.inset-0{inset:0}.inset-x-0{inset-inline:0}.top-0{top:0}.top-1{top:var(--spacing)}.top-1\\/2{top:50%}.top-3{top:calc(var(--spacing) * 3)}.top-full{top:100%}.right-0{right:0}.right-1{right:var(--spacing)}.right-2{right:calc(var(--spacing) * 2)}.right-3{right:calc(var(--spacing) * 3)}.bottom-0{bottom:0}.bottom-3{bottom:calc(var(--spacing) * 3)}.-left-\\[1\\.3rem\\]{left:-1.3rem}.left-0{left:0}.left-2\\.5{left:calc(var(--spacing) * 2.5)}.left-3{left:calc(var(--spacing) * 3)}.z-10{z-index:10}.z-20{z-index:20}.z-30{z-index:30}.float-left{float:left}.container{width:100%}@media(min-width:40rem){.container{max-width:40rem}}@media(min-width:48rem){.container{max-width:48rem}}@media(min-width:64rem){.container{max-width:64rem}}@media(min-width:80rem){.container{max-width:80rem}}@media(min-width:96rem){.container{max-width:96rem}}.mx-auto{margin-inline:auto}.-mt-1{margin-top:calc(var(--spacing) * -1)}.-mt-2{margin-top:calc(var(--spacing) * -2)}.-mt-3{margin-top:calc(var(--spacing) * -3)}.mt-0\\.5{margin-top:calc(var(--spacing) * .5)}.mt-1{margin-top:var(--spacing)}.mt-2{margin-top:calc(var(--spacing) * 2)}.mt-px{margin-top:1px}.mr-1{margin-right:var(--spacing)}.mb-1{margin-bottom:var(--spacing)}.ml-4{margin-left:calc(var(--spacing) * 4)}.ml-5{margin-left:calc(var(--spacing) * 5)}.ml-auto{margin-left:auto}.block{display:block}.contents{display:contents}.flex{display:flex}.grid{display:grid}.hidden{display:none}.inline{display:inline}.inline-block{display:inline-block}.inline-flex{display:inline-flex}.inline-grid{display:inline-grid}.table{display:table}.size-1\\.5{width:calc(var(--spacing) * 1.5);height:calc(var(--spacing) * 1.5)}.size-2{width:calc(var(--spacing) * 2);height:calc(var(--spacing) * 2)}.size-2\\.5{width:calc(var(--spacing) * 2.5);height:calc(var(--spacing) * 2.5)}.size-3{width:calc(var(--spacing) * 3);height:calc(var(--spacing) * 3)}.size-3\\.5{width:calc(var(--spacing) * 3.5);height:calc(var(--spacing) * 3.5)}.size-4{width:calc(var(--spacing) * 4);height:calc(var(--spacing) * 4)}.size-5{width:calc(var(--spacing) * 5);height:calc(var(--spacing) * 5)}.size-6{width:calc(var(--spacing) * 6);height:calc(var(--spacing) * 6)}.size-7{width:calc(var(--spacing) * 7);height:calc(var(--spacing) * 7)}.size-8{width:calc(var(--spacing) * 8);height:calc(var(--spacing) * 8)}.size-9{width:calc(var(--spacing) * 9);height:calc(var(--spacing) * 9)}.size-full{width:100%;height:100%}.h-1\\.5{height:calc(var(--spacing) * 1.5)}.h-5{height:calc(var(--spacing) * 5)}.h-6{height:calc(var(--spacing) * 6)}.h-7{height:calc(var(--spacing) * 7)}.h-8{height:calc(var(--spacing) * 8)}.h-9{height:calc(var(--spacing) * 9)}.h-10{height:calc(var(--spacing) * 10)}.h-72{height:calc(var(--spacing) * 72)}.h-\\[calc\\(100\\%_-_1px\\)\\]{height:calc(100% - 1px)}.h-dvh{height:100dvh}.h-full{height:100%}.max-h-40{max-height:calc(var(--spacing) * 40)}.max-h-48{max-height:calc(var(--spacing) * 48)}.max-h-\\[60\\%\\]{max-height:60%}.max-h-\\[60vh\\]{max-height:60vh}.max-h-\\[80\\%\\]{max-height:80%}.min-h-0{min-height:0}.w-4{width:calc(var(--spacing) * 4)}.w-24{width:calc(var(--spacing) * 24)}.w-44{width:calc(var(--spacing) * 44)}.w-64{width:calc(var(--spacing) * 64)}.w-96{width:calc(var(--spacing) * 96)}.w-\\[26rem\\]{width:26rem}.w-fit{width:fit-content}.w-full{width:100%}.max-w-4xl{max-width:var(--container-4xl)}.max-w-5xl{max-width:var(--container-5xl)}.max-w-40{max-width:calc(var(--spacing) * 40)}.max-w-64{max-width:calc(var(--spacing) * 64)}.max-w-72{max-width:calc(var(--spacing) * 72)}.max-w-\\[calc\\(100\\%-1\\.5rem\\)\\]{max-width:calc(100% - 1.5rem)}.max-w-lg{max-width:var(--container-lg)}.max-w-xl{max-width:var(--container-xl)}.max-w-xs{max-width:var(--container-xs)}.min-w-0{min-width:0}.min-w-5{min-width:calc(var(--spacing) * 5)}.min-w-40{min-width:calc(var(--spacing) * 40)}.flex-1{flex:1}.shrink-0{flex-shrink:0}.border-collapse{border-collapse:collapse}.-translate-x-1\\/2{--tw-translate-x: -50% ;translate:var(--tw-translate-x) var(--tw-translate-y)}.-translate-y-1\\/2{--tw-translate-y: -50% ;translate:var(--tw-translate-x) var(--tw-translate-y)}.-translate-y-full{--tw-translate-y:-100%;translate:var(--tw-translate-x) var(--tw-translate-y)}.transform{transform:var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)}.animate-pulse{animation:var(--animate-pulse)}.animate-spin{animation:var(--animate-spin)}.cursor-grab{cursor:grab}.cursor-pointer{cursor:pointer}.touch-none{touch-action:none}.scroll-mt-4{scroll-margin-top:calc(var(--spacing) * 4)}.list-disc{list-style-type:disc}.grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}.grid-cols-\\[7rem_1fr\\]{grid-template-columns:7rem 1fr}.grid-cols-\\[auto_1fr\\]{grid-template-columns:auto 1fr}.grid-cols-\\[minmax\\(0\\,1fr\\)\\]{grid-template-columns:minmax(0,1fr)}.grid-rows-\\[auto_1fr\\]{grid-template-rows:auto 1fr}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.place-content-center{place-content:center}.place-items-center{place-items:center}.items-baseline{align-items:baseline}.items-center{align-items:center}.items-end{align-items:flex-end}.items-start{align-items:flex-start}.justify-between{justify-content:space-between}.justify-center{justify-content:center}.gap-0{gap:0}.gap-0\\.5{gap:calc(var(--spacing) * .5)}.gap-1{gap:var(--spacing)}.gap-1\\.5{gap:calc(var(--spacing) * 1.5)}.gap-2{gap:calc(var(--spacing) * 2)}.gap-2\\.5{gap:calc(var(--spacing) * 2.5)}.gap-3{gap:calc(var(--spacing) * 3)}.gap-5{gap:calc(var(--spacing) * 5)}.gap-8{gap:calc(var(--spacing) * 8)}.gap-x-2{column-gap:calc(var(--spacing) * 2)}.gap-x-3{column-gap:calc(var(--spacing) * 3)}.gap-x-4{column-gap:calc(var(--spacing) * 4)}.gap-x-6{column-gap:calc(var(--spacing) * 6)}.gap-y-0\\.5{row-gap:calc(var(--spacing) * .5)}.gap-y-1{row-gap:var(--spacing)}.gap-y-1\\.5{row-gap:calc(var(--spacing) * 1.5)}.gap-y-2{row-gap:calc(var(--spacing) * 2)}:where(.divide-y>:not(:last-child)){--tw-divide-y-reverse:0;border-bottom-style:var(--tw-border-style);border-top-style:var(--tw-border-style);border-top-width:calc(1px * var(--tw-divide-y-reverse));border-bottom-width:calc(1px * calc(1 - var(--tw-divide-y-reverse)))}.self-start{align-self:flex-start}.truncate{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.overflow-auto{overflow:auto}.overflow-hidden{overflow:hidden}.overflow-x-auto{overflow-x:auto}.overflow-y-auto{overflow-y:auto}.rounded{border-radius:.25rem}.rounded-4xl{border-radius:var(--radius-4xl)}.rounded-\\[4px\\]{border-radius:4px}.rounded-\\[inherit\\]{border-radius:inherit}.rounded-\\[min\\(var\\(--radius-md\\)\\,10px\\)\\]{border-radius:min(var(--radius-md),10px)}.rounded-\\[min\\(var\\(--radius-md\\)\\,12px\\)\\]{border-radius:min(var(--radius-md),12px)}.rounded-full{border-radius:3.40282e38px}.rounded-lg{border-radius:var(--radius)}.rounded-md{border-radius:calc(var(--radius) - 2px)}.rounded-sm{border-radius:calc(var(--radius) - 4px)}.border{border-style:var(--tw-border-style);border-width:1px}.border-t{border-top-style:var(--tw-border-style);border-top-width:1px}.border-r{border-right-style:var(--tw-border-style);border-right-width:1px}.border-b{border-bottom-style:var(--tw-border-style);border-bottom-width:1px}.border-l{border-left-style:var(--tw-border-style);border-left-width:1px}.border-l-2{border-left-style:var(--tw-border-style);border-left-width:2px}.border-dashed{--tw-border-style:dashed;border-style:dashed}.border-amber-500\\/40{border-color:#f99c0066}@supports (color:color-mix(in lab,red,red)){.border-amber-500\\/40{border-color:color-mix(in oklab,var(--color-amber-500) 40%,transparent)}}.border-amber-500\\/50{border-color:#f99c0080}@supports (color:color-mix(in lab,red,red)){.border-amber-500\\/50{border-color:color-mix(in oklab,var(--color-amber-500) 50%,transparent)}}.border-amber-600\\/40{border-color:#dd740066}@supports (color:color-mix(in lab,red,red)){.border-amber-600\\/40{border-color:color-mix(in oklab,var(--color-amber-600) 40%,transparent)}}.border-amber-600\\/50{border-color:#dd740080}@supports (color:color-mix(in lab,red,red)){.border-amber-600\\/50{border-color:color-mix(in oklab,var(--color-amber-600) 50%,transparent)}}.border-amber-600\\/60{border-color:#dd740099}@supports (color:color-mix(in lab,red,red)){.border-amber-600\\/60{border-color:color-mix(in oklab,var(--color-amber-600) 60%,transparent)}}.border-black\\/20{border-color:#0003}@supports (color:color-mix(in lab,red,red)){.border-black\\/20{border-color:color-mix(in oklab,var(--color-black) 20%,transparent)}}.border-border{border-color:var(--border)}.border-destructive\\/40{border-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.border-destructive\\/40{border-color:color-mix(in oklab,var(--destructive) 40%,transparent)}}.border-destructive\\/50{border-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.border-destructive\\/50{border-color:color-mix(in oklab,var(--destructive) 50%,transparent)}}.border-emerald-600\\/40{border-color:#00976766}@supports (color:color-mix(in lab,red,red)){.border-emerald-600\\/40{border-color:color-mix(in oklab,var(--color-emerald-600) 40%,transparent)}}.border-gilt,.border-gilt\\/60{border-color:var(--gilt)}@supports (color:color-mix(in lab,red,red)){.border-gilt\\/60{border-color:color-mix(in oklab,var(--gilt) 60%,transparent)}}.border-input{border-color:var(--input)}.border-muted-foreground,.border-muted-foreground\\/50{border-color:var(--muted-foreground)}@supports (color:color-mix(in lab,red,red)){.border-muted-foreground\\/50{border-color:color-mix(in oklab,var(--muted-foreground) 50%,transparent)}}.border-sky-600\\/40{border-color:#0084cc66}@supports (color:color-mix(in lab,red,red)){.border-sky-600\\/40{border-color:color-mix(in oklab,var(--color-sky-600) 40%,transparent)}}.border-transparent{border-color:#0000}.bg-accent{background-color:var(--accent)}.bg-amber-300{background-color:var(--color-amber-300)}.bg-amber-500\\/5{background-color:#f99c000d}@supports (color:color-mix(in lab,red,red)){.bg-amber-500\\/5{background-color:color-mix(in oklab,var(--color-amber-500) 5%,transparent)}}.bg-amber-500\\/10{background-color:#f99c001a}@supports (color:color-mix(in lab,red,red)){.bg-amber-500\\/10{background-color:color-mix(in oklab,var(--color-amber-500) 10%,transparent)}}.bg-background{background-color:var(--background)}.bg-border{background-color:var(--border)}.bg-card{background-color:var(--card)}.bg-destructive\\/10{background-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.bg-destructive\\/10{background-color:color-mix(in oklab,var(--destructive) 10%,transparent)}}.bg-emerald-600\\/10{background-color:#0097671a}@supports (color:color-mix(in lab,red,red)){.bg-emerald-600\\/10{background-color:color-mix(in oklab,var(--color-emerald-600) 10%,transparent)}}.bg-foreground\\/70{background-color:var(--foreground)}@supports (color:color-mix(in lab,red,red)){.bg-foreground\\/70{background-color:color-mix(in oklab,var(--foreground) 70%,transparent)}}.bg-gilt{background-color:var(--gilt)}.bg-graph-surface{background-color:var(--graph-surface)}.bg-muted,.bg-muted\\/50{background-color:var(--muted)}@supports (color:color-mix(in lab,red,red)){.bg-muted\\/50{background-color:color-mix(in oklab,var(--muted) 50%,transparent)}}.bg-muted\\/60{background-color:var(--muted)}@supports (color:color-mix(in lab,red,red)){.bg-muted\\/60{background-color:color-mix(in oklab,var(--muted) 60%,transparent)}}.bg-popover{background-color:var(--popover)}.bg-primary{background-color:var(--primary)}.bg-secondary{background-color:var(--secondary)}.bg-sky-600\\/10{background-color:#0084cc1a}@supports (color:color-mix(in lab,red,red)){.bg-sky-600\\/10{background-color:color-mix(in oklab,var(--color-sky-600) 10%,transparent)}}.bg-spine{background-color:var(--spine)}.bg-transparent{background-color:#0000}.bg-white\\/15{background-color:#ffffff26}@supports (color:color-mix(in lab,red,red)){.bg-white\\/15{background-color:color-mix(in oklab,var(--color-white) 15%,transparent)}}.bg-clip-padding{background-clip:padding-box}.p-0\\.5{padding:calc(var(--spacing) * .5)}.p-1{padding:var(--spacing)}.p-2{padding:calc(var(--spacing) * 2)}.p-3{padding:calc(var(--spacing) * 3)}.p-4{padding:calc(var(--spacing) * 4)}.p-5{padding:calc(var(--spacing) * 5)}.p-6{padding:calc(var(--spacing) * 6)}.p-\\[3px\\]{padding:3px}.p-px{padding:1px}.px-1{padding-inline:var(--spacing)}.px-1\\.5{padding-inline:calc(var(--spacing) * 1.5)}.px-2{padding-inline:calc(var(--spacing) * 2)}.px-2\\.5{padding-inline:calc(var(--spacing) * 2.5)}.px-3{padding-inline:calc(var(--spacing) * 3)}.px-4{padding-inline:calc(var(--spacing) * 4)}.py-0\\.5{padding-block:calc(var(--spacing) * .5)}.py-1{padding-block:var(--spacing)}.py-1\\.5{padding-block:calc(var(--spacing) * 1.5)}.py-2{padding-block:calc(var(--spacing) * 2)}.py-3{padding-block:calc(var(--spacing) * 3)}.py-5{padding-block:calc(var(--spacing) * 5)}.py-6{padding-block:calc(var(--spacing) * 6)}.py-px{padding-block:1px}.pt-1\\.5{padding-top:calc(var(--spacing) * 1.5)}.pt-3{padding-top:calc(var(--spacing) * 3)}.pr-2{padding-right:calc(var(--spacing) * 2)}.pr-2\\.5{padding-right:calc(var(--spacing) * 2.5)}.pr-14{padding-right:calc(var(--spacing) * 14)}.pb-1{padding-bottom:var(--spacing)}.pl-0\\.5{padding-left:calc(var(--spacing) * .5)}.pl-1{padding-left:var(--spacing)}.pl-2\\.5{padding-left:calc(var(--spacing) * 2.5)}.pl-3{padding-left:calc(var(--spacing) * 3)}.pl-4{padding-left:calc(var(--spacing) * 4)}.pl-5{padding-left:calc(var(--spacing) * 5)}.pl-7\\.5{padding-left:calc(var(--spacing) * 7.5)}.pl-8{padding-left:calc(var(--spacing) * 8)}.text-center{text-align:center}.text-left{text-align:left}.text-right{text-align:right}.align-top{vertical-align:top}.section-title{font-family:var(--font-serif);letter-spacing:.005em;color:var(--foreground);font-size:.9375rem;font-weight:600}.font-mono{font-family:var(--font-mono)}.font-sans{font-family:var(--font-sans)}.font-serif{font-family:Iowan Old Style,Palatino Linotype,Palatino,Book Antiqua,Georgia,serif}.text-2xl{font-size:var(--text-2xl);line-height:var(--tw-leading,var(--text-2xl--line-height))}.text-4xl{font-size:var(--text-4xl);line-height:var(--tw-leading,var(--text-4xl--line-height))}.text-base{font-size:var(--text-base);line-height:var(--tw-leading,var(--text-base--line-height))}.text-lg{font-size:var(--text-lg);line-height:var(--tw-leading,var(--text-lg--line-height))}.text-sm{font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height))}.text-xl{font-size:var(--text-xl);line-height:var(--tw-leading,var(--text-xl--line-height))}.text-xs{font-size:var(--text-xs);line-height:var(--tw-leading,var(--text-xs--line-height))}.text-\\[0\\.8rem\\]{font-size:.8rem}.text-\\[0\\.85em\\]{font-size:.85em}.text-\\[10px\\]{font-size:10px}.text-\\[11px\\]{font-size:11px}.leading-4{--tw-leading:calc(var(--spacing) * 4);line-height:calc(var(--spacing) * 4)}.leading-none{--tw-leading:1;line-height:1}.leading-relaxed{--tw-leading:var(--leading-relaxed);line-height:var(--leading-relaxed)}.leading-snug{--tw-leading:var(--leading-snug);line-height:var(--leading-snug)}.leading-tight{--tw-leading:var(--leading-tight);line-height:var(--leading-tight)}.font-medium{--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium)}.font-normal{--tw-font-weight:var(--font-weight-normal);font-weight:var(--font-weight-normal)}.font-semibold{--tw-font-weight:var(--font-weight-semibold);font-weight:var(--font-weight-semibold)}.tracking-wide{--tw-tracking:var(--tracking-wide);letter-spacing:var(--tracking-wide)}.break-words{overflow-wrap:break-word}.break-all{word-break:break-all}.whitespace-nowrap{white-space:nowrap}.whitespace-pre-wrap{white-space:pre-wrap}.text-accent-foreground{color:var(--accent-foreground)}.text-amber-300{color:var(--color-amber-300)}.text-amber-600{color:var(--color-amber-600)}.text-amber-700{color:var(--color-amber-700)}.text-amber-800{color:var(--color-amber-800)}.text-amber-900{color:var(--color-amber-900)}.text-current{color:currentColor}.text-destructive{color:var(--destructive)}.text-emerald-600{color:var(--color-emerald-600)}.text-emerald-700{color:var(--color-emerald-700)}.text-emerald-800{color:var(--color-emerald-800)}.text-foreground,.text-foreground\\/60{color:var(--foreground)}@supports (color:color-mix(in lab,red,red)){.text-foreground\\/60{color:color-mix(in oklab,var(--foreground) 60%,transparent)}}.text-gilt{color:var(--gilt)}.text-muted-foreground{color:var(--muted-foreground)}.text-popover-foreground{color:var(--popover-foreground)}.text-primary{color:var(--primary)}.text-primary-foreground{color:var(--primary-foreground)}.text-red-300{color:var(--color-red-300)}.text-secondary-foreground{color:var(--secondary-foreground)}.text-sky-800{color:var(--color-sky-800)}.text-spine-foreground{color:var(--spine-foreground)}.text-spine-muted{color:var(--spine-muted)}.text-white{color:var(--color-white)}.uppercase{text-transform:uppercase}.italic{font-style:italic}.tabular-nums{--tw-numeric-spacing:tabular-nums;font-variant-numeric:var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,)}.line-through{text-decoration-line:line-through}.underline{text-decoration-line:underline}.decoration-1{text-decoration-thickness:1px}.underline-offset-2{text-underline-offset:2px}.underline-offset-4{text-underline-offset:4px}.opacity-40{opacity:.4}.opacity-50{opacity:.5}.shadow{--tw-shadow:0 1px 3px 0 var(--tw-shadow-color,#0000001a), 0 1px 2px -1px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.shadow-\\[0_-8px_24px_-12px_rgb\\(0_0_0\\/0\\.25\\)\\]{--tw-shadow:0 -8px 24px -12px var(--tw-shadow-color,#00000040);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.shadow-\\[0_1px_0_var\\(--border\\)\\]{--tw-shadow:0 1px 0 var(--tw-shadow-color,var(--border));box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.shadow-lg{--tw-shadow:0 10px 15px -3px var(--tw-shadow-color,#0000001a), 0 4px 6px -4px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.shadow-md{--tw-shadow:0 4px 6px -1px var(--tw-shadow-color,#0000001a), 0 2px 4px -2px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.shadow-sm{--tw-shadow:0 1px 3px 0 var(--tw-shadow-color,#0000001a), 0 1px 2px -1px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.ring-2{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.ring-ring\\/50{--tw-ring-color:var(--ring)}@supports (color:color-mix(in lab,red,red)){.ring-ring\\/50{--tw-ring-color:color-mix(in oklab, var(--ring) 50%, transparent)}}.outline{outline-style:var(--tw-outline-style);outline-width:1px}.filter{filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.transition-\\[color\\,box-shadow\\]{transition-property:color,box-shadow;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-all{transition-property:all;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-colors{transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-opacity{transition-property:opacity;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-none{transition-property:none}.outline-none{--tw-outline-style:none;outline-style:none}.select-all{-webkit-user-select:all;user-select:all}.select-none{-webkit-user-select:none;user-select:none}.running{animation-play-state:running}@media(hover:hover){.group-hover\\:inline:is(:where(.group):hover *){display:inline}}.group-has-disabled\\/field\\:opacity-50:is(:where(.group\\/field):has(:disabled) *){opacity:.5}.group-has-\\[\\:focus-visible\\]\\/field-label\\:ring-0:is(:where(.group\\/field-label):has(:focus-visible) *){--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(0px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.group-has-\\[\\:focus-visible\\]\\/field-label\\:not-data-checked\\:border-input:is(:where(.group\\/field-label):has(:focus-visible) *):not([data-checked]){border-color:var(--input)}.group-data-horizontal\\/tabs\\:h-8:is(:where(.group\\/tabs)[data-horizontal] *){height:calc(var(--spacing) * 8)}.group-data-vertical\\/tabs\\:h-fit:is(:where(.group\\/tabs)[data-vertical] *){height:fit-content}.group-data-vertical\\/tabs\\:w-full:is(:where(.group\\/tabs)[data-vertical] *){width:100%}.group-data-vertical\\/tabs\\:flex-col:is(:where(.group\\/tabs)[data-vertical] *){flex-direction:column}.group-data-vertical\\/tabs\\:justify-start:is(:where(.group\\/tabs)[data-vertical] *){justify-content:flex-start}.group-data-\\[variant\\=line\\]\\/tabs-list\\:bg-transparent:is(:where(.group\\/tabs-list)[data-variant=line] *){background-color:#0000}.file\\:inline-flex::file-selector-button{display:inline-flex}.file\\:h-6::file-selector-button{height:calc(var(--spacing) * 6)}.file\\:border-0::file-selector-button{border-style:var(--tw-border-style);border-width:0}.file\\:bg-transparent::file-selector-button{background-color:#0000}.file\\:text-sm::file-selector-button{font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height))}.file\\:font-medium::file-selector-button{--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium)}.file\\:text-foreground::file-selector-button{color:var(--foreground)}.placeholder\\:text-muted-foreground::placeholder{color:var(--muted-foreground)}.after\\:absolute:after{content:var(--tw-content);position:absolute}.after\\:-inset-x-3:after{content:var(--tw-content);inset-inline:calc(var(--spacing) * -3)}.after\\:-inset-y-2:after{content:var(--tw-content);inset-block:calc(var(--spacing) * -2)}.after\\:bg-foreground:after{content:var(--tw-content);background-color:var(--foreground)}.after\\:opacity-0:after{content:var(--tw-content);opacity:0}.after\\:transition-opacity:after{content:var(--tw-content);transition-property:opacity;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.group-data-horizontal\\/tabs\\:after\\:inset-x-0:is(:where(.group\\/tabs)[data-horizontal] *):after{content:var(--tw-content);inset-inline:0}.group-data-horizontal\\/tabs\\:after\\:bottom-\\[-5px\\]:is(:where(.group\\/tabs)[data-horizontal] *):after{content:var(--tw-content);bottom:-5px}.group-data-horizontal\\/tabs\\:after\\:h-0\\.5:is(:where(.group\\/tabs)[data-horizontal] *):after{content:var(--tw-content);height:calc(var(--spacing) * .5)}.group-data-vertical\\/tabs\\:after\\:inset-y-0:is(:where(.group\\/tabs)[data-vertical] *):after{content:var(--tw-content);inset-block:0}.group-data-vertical\\/tabs\\:after\\:-right-1:is(:where(.group\\/tabs)[data-vertical] *):after{content:var(--tw-content);right:calc(var(--spacing) * -1)}.group-data-vertical\\/tabs\\:after\\:w-0\\.5:is(:where(.group\\/tabs)[data-vertical] *):after{content:var(--tw-content);width:calc(var(--spacing) * .5)}@media(hover:hover){.hover\\:border-ring\\/60:hover{border-color:var(--ring)}@supports (color:color-mix(in lab,red,red)){.hover\\:border-ring\\/60:hover{border-color:color-mix(in oklab,var(--ring) 60%,transparent)}}.hover\\:bg-\\[color-mix\\(in_oklch\\,var\\(--secondary\\)\\,var\\(--foreground\\)_5\\%\\)\\]:hover{background-color:var(--secondary)}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-\\[color-mix\\(in_oklch\\,var\\(--secondary\\)\\,var\\(--foreground\\)_5\\%\\)\\]:hover{background-color:color-mix(in oklch,var(--secondary),var(--foreground) 5%)}}.hover\\:bg-destructive\\/20:hover{background-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-destructive\\/20:hover{background-color:color-mix(in oklab,var(--destructive) 20%,transparent)}}.hover\\:bg-muted:hover,.hover\\:bg-muted\\/60:hover{background-color:var(--muted)}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-muted\\/60:hover{background-color:color-mix(in oklab,var(--muted) 60%,transparent)}}.hover\\:bg-primary\\/80:hover{background-color:var(--primary)}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-primary\\/80:hover{background-color:color-mix(in oklab,var(--primary) 80%,transparent)}}.hover\\:bg-white\\/10:hover{background-color:#ffffff1a}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-white\\/10:hover{background-color:color-mix(in oklab,var(--color-white) 10%,transparent)}}.hover\\:text-foreground:hover{color:var(--foreground)}.hover\\:text-muted-foreground:hover{color:var(--muted-foreground)}.hover\\:text-spine-foreground:hover{color:var(--spine-foreground)}.hover\\:underline:hover{text-decoration-line:underline}}.focus-visible\\:border-destructive\\/40:focus-visible{border-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.focus-visible\\:border-destructive\\/40:focus-visible{border-color:color-mix(in oklab,var(--destructive) 40%,transparent)}}.focus-visible\\:border-ring:focus-visible{border-color:var(--ring)}.focus-visible\\:ring-3:focus-visible,.focus-visible\\:ring-\\[3px\\]:focus-visible{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.focus-visible\\:ring-destructive\\/20:focus-visible{--tw-ring-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.focus-visible\\:ring-destructive\\/20:focus-visible{--tw-ring-color:color-mix(in oklab, var(--destructive) 20%, transparent)}}.focus-visible\\:ring-ring\\/50:focus-visible{--tw-ring-color:var(--ring)}@supports (color:color-mix(in lab,red,red)){.focus-visible\\:ring-ring\\/50:focus-visible{--tw-ring-color:color-mix(in oklab, var(--ring) 50%, transparent)}}.focus-visible\\:outline-1:focus-visible{outline-style:var(--tw-outline-style);outline-width:1px}.focus-visible\\:outline-ring:focus-visible{outline-color:var(--ring)}.active\\:cursor-grabbing:active{cursor:grabbing}.active\\:not-aria-\\[haspopup\\]\\:translate-y-px:active:not([aria-haspopup]){--tw-translate-y:1px;translate:var(--tw-translate-x) var(--tw-translate-y)}.disabled\\:pointer-events-none:disabled{pointer-events:none}.disabled\\:cursor-default:disabled{cursor:default}.disabled\\:cursor-not-allowed:disabled{cursor:not-allowed}.disabled\\:bg-input\\/50:disabled{background-color:var(--input)}@supports (color:color-mix(in lab,red,red)){.disabled\\:bg-input\\/50:disabled{background-color:color-mix(in oklab,var(--input) 50%,transparent)}}.disabled\\:opacity-50:disabled{opacity:.5}@media(hover:hover){.disabled\\:hover\\:bg-transparent:disabled:hover{background-color:#0000}}:where([data-slot=button-group]) .in-data-\\[slot\\=button-group\\]\\:rounded-lg{border-radius:var(--radius)}:where([data-slot=tooltip-content]) .in-data-\\[slot\\=tooltip-content\\]\\:bg-background\\/20{background-color:var(--background)}@supports (color:color-mix(in lab,red,red)){:where([data-slot=tooltip-content]) .in-data-\\[slot\\=tooltip-content\\]\\:bg-background\\/20{background-color:color-mix(in oklab,var(--background) 20%,transparent)}}:where([data-slot=tooltip-content]) .in-data-\\[slot\\=tooltip-content\\]\\:text-background{color:var(--background)}.has-data-\\[icon\\=inline-end\\]\\:pr-1:has([data-icon=inline-end]){padding-right:var(--spacing)}.has-data-\\[icon\\=inline-end\\]\\:pr-1\\.5:has([data-icon=inline-end]){padding-right:calc(var(--spacing) * 1.5)}.has-data-\\[icon\\=inline-end\\]\\:pr-2:has([data-icon=inline-end]){padding-right:calc(var(--spacing) * 2)}.has-data-\\[icon\\=inline-start\\]\\:pl-1:has([data-icon=inline-start]){padding-left:var(--spacing)}.has-data-\\[icon\\=inline-start\\]\\:pl-1\\.5:has([data-icon=inline-start]){padding-left:calc(var(--spacing) * 1.5)}.has-data-\\[icon\\=inline-start\\]\\:pl-2:has([data-icon=inline-start]){padding-left:calc(var(--spacing) * 2)}.aria-expanded\\:bg-muted[aria-expanded=true]{background-color:var(--muted)}.aria-expanded\\:bg-secondary[aria-expanded=true]{background-color:var(--secondary)}.aria-expanded\\:text-foreground[aria-expanded=true]{color:var(--foreground)}.aria-expanded\\:text-secondary-foreground[aria-expanded=true]{color:var(--secondary-foreground)}.aria-invalid\\:border-destructive[aria-invalid=true]{border-color:var(--destructive)}.aria-invalid\\:ring-3[aria-invalid=true]{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.aria-invalid\\:ring-destructive\\/20[aria-invalid=true]{--tw-ring-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.aria-invalid\\:ring-destructive\\/20[aria-invalid=true]{--tw-ring-color:color-mix(in oklab, var(--destructive) 20%, transparent)}}.aria-invalid\\:aria-checked\\:border-primary[aria-invalid=true][aria-checked=true]{border-color:var(--primary)}.aria-pressed\\:bg-muted[aria-pressed=true]{background-color:var(--muted)}.aria-pressed\\:text-foreground[aria-pressed=true]{color:var(--foreground)}.data-active\\:bg-background[data-active]{background-color:var(--background)}.data-active\\:text-foreground[data-active]{color:var(--foreground)}.group-data-\\[variant\\=default\\]\\/tabs-list\\:data-active\\:shadow-sm:is(:where(.group\\/tabs-list)[data-variant=default] *)[data-active]{--tw-shadow:0 1px 3px 0 var(--tw-shadow-color,#0000001a), 0 1px 2px -1px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.group-data-\\[variant\\=line\\]\\/tabs-list\\:data-active\\:bg-transparent:is(:where(.group\\/tabs-list)[data-variant=line] *)[data-active]{background-color:#0000}.group-data-\\[variant\\=line\\]\\/tabs-list\\:data-active\\:shadow-none:is(:where(.group\\/tabs-list)[data-variant=line] *)[data-active]{--tw-shadow:0 0 #0000;box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.group-data-\\[variant\\=line\\]\\/tabs-list\\:data-active\\:after\\:opacity-100:is(:where(.group\\/tabs-list)[data-variant=line] *)[data-active]:after{content:var(--tw-content);opacity:1}.data-checked\\:border-primary[data-checked]{border-color:var(--primary)}.data-checked\\:bg-primary[data-checked]{background-color:var(--primary)}.data-checked\\:text-primary-foreground[data-checked]{color:var(--primary-foreground)}.group-has-\\[\\:focus-visible\\]\\/field-label\\:data-checked\\:border-primary:is(:where(.group\\/field-label):has(:focus-visible) *)[data-checked]{border-color:var(--primary)}.data-horizontal\\:h-2\\.5[data-horizontal]{height:calc(var(--spacing) * 2.5)}.data-horizontal\\:h-px[data-horizontal]{height:1px}.data-horizontal\\:w-full[data-horizontal]{width:100%}.data-horizontal\\:flex-col[data-horizontal]{flex-direction:column}.data-horizontal\\:border-t[data-horizontal]{border-top-style:var(--tw-border-style);border-top-width:1px}.data-horizontal\\:border-t-transparent[data-horizontal]{border-top-color:#0000}.data-vertical\\:h-full[data-vertical]{height:100%}.data-vertical\\:w-2\\.5[data-vertical]{width:calc(var(--spacing) * 2.5)}.data-vertical\\:w-px[data-vertical]{width:1px}.data-vertical\\:self-stretch[data-vertical]{align-self:stretch}.data-vertical\\:border-l[data-vertical]{border-left-style:var(--tw-border-style);border-left-width:1px}.data-vertical\\:border-l-transparent[data-vertical]{border-left-color:#0000}.data-\\[variant\\=line\\]\\:rounded-none[data-variant=line]{border-radius:0}@media(min-width:40rem){.sm\\:inline{display:inline}.sm\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.sm\\:px-6{padding-inline:calc(var(--spacing) * 6)}}@media(min-width:48rem){.md\\:inline{display:inline}.md\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.md\\:text-sm{font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height))}}@media(min-width:64rem){.lg\\:relative{position:relative}.lg\\:z-auto{z-index:auto}.lg\\:col-start-2{grid-column-start:2}.lg\\:block{display:block}.lg\\:inline-flex{display:inline-flex}.lg\\:max-h-none{max-height:none}.lg\\:w-\\[480px\\]{width:480px}.lg\\:max-w-\\[45vw\\]{max-width:45vw}.lg\\:grid-cols-\\[auto_1fr\\]{grid-template-columns:auto 1fr}.lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_auto\\]{grid-template-columns:minmax(0,1fr) auto}.lg\\:border-t-0{border-top-style:var(--tw-border-style);border-top-width:0}.lg\\:border-l{border-left-style:var(--tw-border-style);border-left-width:1px}.lg\\:shadow-none{--tw-shadow:0 0 #0000;box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}}@media(min-width:80rem){.xl\\:inline{display:inline}}@media(min-width:96rem){.\\32xl\\:inline{display:inline}}.dark\\:border-input:is(.dark *){border-color:var(--input)}.dark\\:bg-destructive\\/20:is(.dark *){background-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.dark\\:bg-destructive\\/20:is(.dark *){background-color:color-mix(in oklab,var(--destructive) 20%,transparent)}}.dark\\:bg-input\\/30:is(.dark *){background-color:var(--input)}@supports (color:color-mix(in lab,red,red)){.dark\\:bg-input\\/30:is(.dark *){background-color:color-mix(in oklab,var(--input) 30%,transparent)}}.dark\\:text-amber-200:is(.dark *){color:var(--color-amber-200)}.dark\\:text-amber-300:is(.dark *){color:var(--color-amber-300)}.dark\\:text-amber-400:is(.dark *){color:var(--color-amber-400)}.dark\\:text-emerald-300:is(.dark *){color:var(--color-emerald-300)}.dark\\:text-emerald-400:is(.dark *){color:var(--color-emerald-400)}.dark\\:text-muted-foreground:is(.dark *){color:var(--muted-foreground)}.dark\\:text-sky-300:is(.dark *){color:var(--color-sky-300)}@media(hover:hover){.dark\\:hover\\:bg-destructive\\/30:is(.dark *):hover{background-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.dark\\:hover\\:bg-destructive\\/30:is(.dark *):hover{background-color:color-mix(in oklab,var(--destructive) 30%,transparent)}}.dark\\:hover\\:bg-input\\/50:is(.dark *):hover{background-color:var(--input)}@supports (color:color-mix(in lab,red,red)){.dark\\:hover\\:bg-input\\/50:is(.dark *):hover{background-color:color-mix(in oklab,var(--input) 50%,transparent)}}.dark\\:hover\\:bg-muted\\/50:is(.dark *):hover{background-color:var(--muted)}@supports (color:color-mix(in lab,red,red)){.dark\\:hover\\:bg-muted\\/50:is(.dark *):hover{background-color:color-mix(in oklab,var(--muted) 50%,transparent)}}.dark\\:hover\\:text-foreground:is(.dark *):hover{color:var(--foreground)}}.dark\\:focus-visible\\:ring-destructive\\/40:is(.dark *):focus-visible{--tw-ring-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.dark\\:focus-visible\\:ring-destructive\\/40:is(.dark *):focus-visible{--tw-ring-color:color-mix(in oklab, var(--destructive) 40%, transparent)}}.dark\\:disabled\\:bg-input\\/80:is(.dark *):disabled{background-color:var(--input)}@supports (color:color-mix(in lab,red,red)){.dark\\:disabled\\:bg-input\\/80:is(.dark *):disabled{background-color:color-mix(in oklab,var(--input) 80%,transparent)}}:where([data-slot=tooltip-content]) .dark\\:in-data-\\[slot\\=tooltip-content\\]\\:bg-background\\/10:is(.dark *){background-color:var(--background)}@supports (color:color-mix(in lab,red,red)){:where([data-slot=tooltip-content]) .dark\\:in-data-\\[slot\\=tooltip-content\\]\\:bg-background\\/10:is(.dark *){background-color:color-mix(in oklab,var(--background) 10%,transparent)}}.dark\\:aria-invalid\\:border-destructive\\/50:is(.dark *)[aria-invalid=true]{border-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.dark\\:aria-invalid\\:border-destructive\\/50:is(.dark *)[aria-invalid=true]{border-color:color-mix(in oklab,var(--destructive) 50%,transparent)}}.dark\\:aria-invalid\\:ring-destructive\\/40:is(.dark *)[aria-invalid=true]{--tw-ring-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.dark\\:aria-invalid\\:ring-destructive\\/40:is(.dark *)[aria-invalid=true]{--tw-ring-color:color-mix(in oklab, var(--destructive) 40%, transparent)}}.dark\\:data-active\\:border-input:is(.dark *)[data-active]{border-color:var(--input)}.dark\\:data-active\\:bg-input\\/30:is(.dark *)[data-active]{background-color:var(--input)}@supports (color:color-mix(in lab,red,red)){.dark\\:data-active\\:bg-input\\/30:is(.dark *)[data-active]{background-color:color-mix(in oklab,var(--input) 30%,transparent)}}.dark\\:data-active\\:text-foreground:is(.dark *)[data-active]{color:var(--foreground)}.dark\\:group-data-\\[variant\\=line\\]\\/tabs-list\\:data-active\\:border-transparent:is(.dark *):is(:where(.group\\/tabs-list)[data-variant=line] *)[data-active]{border-color:#0000}.dark\\:group-data-\\[variant\\=line\\]\\/tabs-list\\:data-active\\:bg-transparent:is(.dark *):is(:where(.group\\/tabs-list)[data-variant=line] *)[data-active]{background-color:#0000}.dark\\:data-checked\\:bg-primary:is(.dark *)[data-checked]{background-color:var(--primary)}.\\[\\&_svg\\]\\:pointer-events-none svg{pointer-events:none}.\\[\\&_svg\\]\\:shrink-0 svg{flex-shrink:0}.\\[\\&_svg\\:not\\(\\[class\\*\\=\\'size-\\'\\]\\)\\]\\:size-3 svg:not([class*=size-]){width:calc(var(--spacing) * 3);height:calc(var(--spacing) * 3)}.\\[\\&_svg\\:not\\(\\[class\\*\\=\\'size-\\'\\]\\)\\]\\:size-3\\.5 svg:not([class*=size-]){width:calc(var(--spacing) * 3.5);height:calc(var(--spacing) * 3.5)}.\\[\\&_svg\\:not\\(\\[class\\*\\=\\'size-\\'\\]\\)\\]\\:size-4 svg:not([class*=size-]){width:calc(var(--spacing) * 4);height:calc(var(--spacing) * 4)}@media(hover:hover){.\\[a\\]\\:hover\\:bg-destructive\\/20:is(a):hover{background-color:var(--destructive)}@supports (color:color-mix(in lab,red,red)){.\\[a\\]\\:hover\\:bg-destructive\\/20:is(a):hover{background-color:color-mix(in oklab,var(--destructive) 20%,transparent)}}.\\[a\\]\\:hover\\:bg-muted:is(a):hover{background-color:var(--muted)}.\\[a\\]\\:hover\\:bg-primary\\/80:is(a):hover{background-color:var(--primary)}@supports (color:color-mix(in lab,red,red)){.\\[a\\]\\:hover\\:bg-primary\\/80:is(a):hover{background-color:color-mix(in oklab,var(--primary) 80%,transparent)}}.\\[a\\]\\:hover\\:bg-secondary\\/80:is(a):hover{background-color:var(--secondary)}@supports (color:color-mix(in lab,red,red)){.\\[a\\]\\:hover\\:bg-secondary\\/80:is(a):hover{background-color:color-mix(in oklab,var(--secondary) 80%,transparent)}}.\\[a\\]\\:hover\\:text-muted-foreground:is(a):hover{color:var(--muted-foreground)}}.\\[\\&\\>svg\\]\\:pointer-events-none>svg{pointer-events:none}.\\[\\&\\>svg\\]\\:size-3\\!>svg{width:calc(var(--spacing) * 3)!important;height:calc(var(--spacing) * 3)!important}.\\[\\&\\>svg\\]\\:size-3\\.5>svg{width:calc(var(--spacing) * 3.5);height:calc(var(--spacing) * 3.5)}}@property --tw-animation-delay{syntax:"*";inherits:false;initial-value:0s}@property --tw-animation-direction{syntax:"*";inherits:false;initial-value:normal}@property --tw-animation-duration{syntax:"*";inherits:false}@property --tw-animation-fill-mode{syntax:"*";inherits:false;initial-value:none}@property --tw-animation-iteration-count{syntax:"*";inherits:false;initial-value:1}@property --tw-enter-blur{syntax:"*";inherits:false;initial-value:0}@property --tw-enter-opacity{syntax:"*";inherits:false;initial-value:1}@property --tw-enter-rotate{syntax:"*";inherits:false;initial-value:0}@property --tw-enter-scale{syntax:"*";inherits:false;initial-value:1}@property --tw-enter-translate-x{syntax:"*";inherits:false;initial-value:0}@property --tw-enter-translate-y{syntax:"*";inherits:false;initial-value:0}@property --tw-exit-blur{syntax:"*";inherits:false;initial-value:0}@property --tw-exit-opacity{syntax:"*";inherits:false;initial-value:1}@property --tw-exit-rotate{syntax:"*";inherits:false;initial-value:0}@property --tw-exit-scale{syntax:"*";inherits:false;initial-value:1}@property --tw-exit-translate-x{syntax:"*";inherits:false;initial-value:0}@property --tw-exit-translate-y{syntax:"*";inherits:false;initial-value:0}:root,:host{--spine:#1f3b2d;--spine-foreground:#ece6d2;--spine-muted:#a9b5a6;--gilt:#b08d3c;--graph-surface:#f8f8f3;--graph-rule:#e7e8df;--graph-edge:#bfc2b5;--graph-label:#4b524c;--graph-other:#8a8d84;--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--series-5:#e87ba4;--series-6:#008300;--series-7:#4a3aa7;--series-8:#e34948;--series-generated-l:.58;--series-generated-c:.15}.dark{--spine:#0c120e;--spine-foreground:#e4d9b4;--spine-muted:#8d9a90;--gilt:#c9a752;--graph-surface:#141b16;--graph-rule:#1b241e;--graph-edge:#46524a;--graph-label:#bfc6bc;--graph-other:#7f877f;--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--series-5:#d55181;--series-6:#008300;--series-7:#9085e9;--series-8:#e66767;--series-generated-l:.66;--series-generated-c:.14}:host{min-width:0;min-height:0;color:var(--foreground);flex-direction:column;flex:1;font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:flex}@property --tw-translate-x{syntax:"*";inherits:false;initial-value:0}@property --tw-translate-y{syntax:"*";inherits:false;initial-value:0}@property --tw-translate-z{syntax:"*";inherits:false;initial-value:0}@property --tw-rotate-x{syntax:"*";inherits:false}@property --tw-rotate-y{syntax:"*";inherits:false}@property --tw-rotate-z{syntax:"*";inherits:false}@property --tw-skew-x{syntax:"*";inherits:false}@property --tw-skew-y{syntax:"*";inherits:false}@property --tw-divide-y-reverse{syntax:"*";inherits:false;initial-value:0}@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-leading{syntax:"*";inherits:false}@property --tw-font-weight{syntax:"*";inherits:false}@property --tw-tracking{syntax:"*";inherits:false}@property --tw-ordinal{syntax:"*";inherits:false}@property --tw-slashed-zero{syntax:"*";inherits:false}@property --tw-numeric-figure{syntax:"*";inherits:false}@property --tw-numeric-spacing{syntax:"*";inherits:false}@property --tw-numeric-fraction{syntax:"*";inherits:false}@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-shadow-color{syntax:"*";inherits:false}@property --tw-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-inset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-shadow-color{syntax:"*";inherits:false}@property --tw-inset-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-ring-color{syntax:"*";inherits:false}@property --tw-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-ring-color{syntax:"*";inherits:false}@property --tw-inset-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-ring-inset{syntax:"*";inherits:false}@property --tw-ring-offset-width{syntax:"<length>";inherits:false;initial-value:0}@property --tw-ring-offset-color{syntax:"*";inherits:false;initial-value:#fff}@property --tw-ring-offset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-outline-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-blur{syntax:"*";inherits:false}@property --tw-brightness{syntax:"*";inherits:false}@property --tw-contrast{syntax:"*";inherits:false}@property --tw-grayscale{syntax:"*";inherits:false}@property --tw-hue-rotate{syntax:"*";inherits:false}@property --tw-invert{syntax:"*";inherits:false}@property --tw-opacity{syntax:"*";inherits:false}@property --tw-saturate{syntax:"*";inherits:false}@property --tw-sepia{syntax:"*";inherits:false}@property --tw-drop-shadow{syntax:"*";inherits:false}@property --tw-drop-shadow-color{syntax:"*";inherits:false}@property --tw-drop-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-drop-shadow-size{syntax:"*";inherits:false}@property --tw-content{syntax:"*";inherits:false;initial-value:""}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{opacity:.5}}`, Qb = "5";
typeof window < "u" && ((window.__svelte ??= {}).v ??= /* @__PURE__ */ new Set()).add(Qb);
const no = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round"
};
const El = (...e) => e.filter((t, r, n) => !!t && t.trim() !== "" && n.indexOf(t) === r).join(" ").trim();
function Ka(e) {
  return e != null;
}
function e0(e, t = {}) {
  const r = t.attributeNames ?? {}, n = (h) => r[h] ?? h, o = e.size ?? e.width ?? no.width, s = e.size ?? e.height ?? no.height, i = e.aliases?.filter((h) => typeof h == "string" && h.trim() !== "").map((h) => `lucide-${h}`) ?? [], l = [...e.name ? [`lucide-${e.name}`] : [], ...i], c = t.className?.split(" ").filter(Boolean) ?? [], u = t.includeDefaultClasses === !1 ? El(...c) : El("lucide", ...l, ...c), d = t.absoluteStrokeWidth ? Number(t.strokeWidth ?? no["stroke-width"]) * Number(e.size ?? e.width ?? no.width) / Number(t.size ?? t.width ?? no.width) : t.strokeWidth ?? no["stroke-width"];
  return [
    "svg",
    {
      ...Object.entries(no).reduce((h, [p, v]) => (h[n(p)] = v, h), {}),
      ..."color" in t && t.color && {
        [n("stroke")]: t.color
      },
      ..."size" in t && Ka(t.size) && {
        [n("width")]: t.size,
        [n("height")]: t.size
      },
      ..."width" in t && Ka(t.width) && {
        [n("width")]: t.width
      },
      ..."height" in t && Ka(t.height) && {
        [n("height")]: t.height
      },
      [n("stroke-width")]: d,
      ...u && {
        [n("class")]: u
      },
      [n("viewBox")]: `0 0 ${o} ${s}`,
      ...t.hasA11yProp === !1 ? {
        [n("aria-hidden")]: "true"
      } : {},
      ..."attributes" in t && t.attributes
    },
    e.node.map((h) => {
      const [p, v, g] = h, y = t.nonScalingStroke ? { [n("vector-effect")]: "non-scaling-stroke", ...v } : v;
      return g ? [p, y, g] : [p, y];
    })
  ];
}
const t0 = (e) => {
  for (const t in e)
    if (t.startsWith("aria-") || t === "role" || t === "title")
      return !0;
  return !1;
};
const r0 = /* @__PURE__ */ Symbol("lucide-context"), n0 = () => go(r0);
var o0 = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "color",
  "size",
  "width",
  "height",
  "strokeWidth",
  "absoluteStrokeWidth",
  "nonScalingStroke",
  "iconNode",
  "icon",
  "class",
  "children"
]), s0 = /* @__PURE__ */ Yn("<svg><!><!></svg>");
function le(e, t) {
  Ee(t, !0);
  const r = n0() ?? {}, n = be(t, "color", 19, () => r.color ?? "currentColor"), o = be(t, "size", 19, () => r.size ?? 24), s = be(t, "width", 19, o), i = be(t, "height", 19, o), l = be(t, "strokeWidth", 19, () => r.strokeWidth ?? 2), c = be(t, "absoluteStrokeWidth", 19, () => r.absoluteStrokeWidth ?? !1), u = be(t, "nonScalingStroke", 19, () => r.nonScalingStroke ?? !1), d = be(t, "iconNode", 19, () => []), f = be(t, "icon", 19, () => ({ node: d(), aliases: [], size: 24 })), h = /* @__PURE__ */ K(t, o0), p = /* @__PURE__ */ T(() => !!t.children || t0(h)), v = /* @__PURE__ */ T(() => e0(f(), {
    color: n(),
    width: s(),
    height: i(),
    strokeWidth: l(),
    absoluteStrokeWidth: c(),
    nonScalingStroke: u(),
    // @TODO: maybe drop the extra `lucide-icon` class altogether.
    className: El("lucide-icon", r.class),
    hasA11yProp: a(p),
    attributes: h
  })), g = /* @__PURE__ */ T(() => fr(a(v), 3)), y = /* @__PURE__ */ T(() => a(g)[1]), _ = /* @__PURE__ */ T(() => wm(a(g)[2], () => [], !0)), k = /* @__PURE__ */ T(() => ({
    ...a(y),
    class: [...a(y).class.split(" "), t.class]
  }));
  var S = s0();
  Et(S, () => ({ ...a(k) }));
  var b = M(S);
  Ae(b, 17, () => a(_), xt, (E, C) => {
    var w = /* @__PURE__ */ T(() => fr(a(C), 2));
    let O = () => a(w)[0], A = () => a(w)[1];
    var R = Ze(), W = re(R);
    Qh(W, O, !0, (q, P) => {
      Et(q, () => ({ ...A() }));
    }), x(E, R);
  });
  var $ = m(b);
  vt($, () => t.children ?? dt), x(e, S), Me();
}
var i0 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function or(e, t) {
  let r = /* @__PURE__ */ K(t, i0);
  const n = {
    name: "circle-alert",
    size: 24,
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["line", { x1: "12", x2: "12", y1: "8", y2: "12" }],
      [
        "line",
        { x1: "12", x2: "12.01", y1: "16", y2: "16" }
      ]
    ],
    aliases: ["alert-circle"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var a0 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Bn(e, t) {
  let r = /* @__PURE__ */ K(t, a0);
  const n = {
    name: "loader-circle",
    size: 24,
    node: [["path", { d: "M21 12a9 9 0 1 1-6.219-8.56" }]],
    aliases: ["loader-2"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var l0 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function c0(e, t) {
  let r = /* @__PURE__ */ K(t, l0);
  const n = {
    name: "play",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var u0 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Oc(e, t) {
  let r = /* @__PURE__ */ K(t, u0);
  const n = {
    name: "refresh-cw",
    size: 24,
    node: [
      [
        "path",
        { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }
      ],
      ["path", { d: "M21 3v5h-5" }],
      [
        "path",
        { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }
      ],
      ["path", { d: "M8 16H3v5" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var d0 = Array.isArray, _a = (e) => {
  if (!e && e !== 0 && e !== 0n) return "";
  if (typeof e == "string") return e;
  if (typeof e == "number")
    return e !== e ? "" : "" + e;
  if (typeof e == "bigint") return "" + e;
  let t = "";
  if (d0(e)) {
    const r = e.length;
    for (let n = 0; n < r; n++) {
      const o = e[n];
      if (!o && o !== 0 && o !== 0n) continue;
      const s = typeof o == "string" ? o : _a(o);
      s && (t && (t += " "), t += s);
    }
    return t;
  }
  if (typeof e == "object")
    for (const r in e)
      e[r] && (t && (t += " "), t += r);
  return t;
}, f0 = /\s+/g, Ml = Array.isArray, h0 = (e) => typeof e != "string" || !e ? e : e.replace(f0, " ").trim(), p0 = (e) => {
  const t = e.length;
  if (t === 0) return !1;
  const r = e.charCodeAt(0), n = e.charCodeAt(t - 1);
  if (r === 32 || n === 32 || r >= 9 && r <= 13 || r === 160 || n >= 9 && n <= 13 || n === 160)
    return !0;
  for (let o = 0; o < t; o++) {
    const s = e.charCodeAt(o);
    if (s >= 9 && s <= 13 || s === 160 || s === 32 && o + 1 < t && e.charCodeAt(o + 1) === 32) return !0;
  }
  return !1;
}, Ii = (...e) => {
  const t = _a(e);
  if (t)
    return p0(t) ? h0(t) : t;
}, Tl = (e) => e === !1 ? "false" : e === !0 ? "true" : e === 0 ? "0" : e, _r = (e) => {
  if (!e || typeof e != "object") return !0;
  for (const t in e) return !1;
  return !0;
}, lp = (e, t) => {
  if (e === t) return !0;
  if (!e || !t) return !1;
  const r = e, n = t, o = Object.keys(r), s = Object.keys(n);
  if (o.length !== s.length) return !1;
  for (let i = 0; i < o.length; i++) {
    const l = o[i];
    if (!s.includes(l) || r[l] !== n[l]) return !1;
  }
  return !0;
}, v0 = (e, t) => {
  const r = e;
  for (const n in t)
    if (Object.hasOwn(t, n)) {
      const o = t[n];
      n in r ? r[n] = Ii(r[n], o) : r[n] = o;
    }
  return e;
}, cp = (e, t) => {
  for (let r = 0; r < e.length; r++) {
    const n = e[r];
    Ml(n) ? cp(n, t) : n && t.push(n);
  }
}, Cl = (...e) => {
  const t = [];
  cp(e, t);
  const r = [];
  for (let n = 0; n < t.length; n++)
    t[n] && r.push(t[n]);
  return r;
}, Nc = (e, t) => {
  const r = e, n = t, o = {};
  for (const s in r) {
    const i = r[s];
    if (s in n) {
      const l = n[s];
      Ml(i) || Ml(l) ? o[s] = Cl(l, i) : typeof i == "object" && typeof l == "object" && i && l ? o[s] = Nc(i, l) : o[s] = l + " " + i;
    } else
      o[s] = i;
  }
  for (const s in n)
    s in r || (o[s] = n[s]);
  return o;
}, g0 = {
  twMerge: !0,
  twMergeConfig: {}
}, up = 256, m0 = 128, xo = /* @__PURE__ */ Symbol("tv-cache-miss"), b0 = (e) => e?.class != null && e.class !== "" || e?.className != null && e.className !== "", ld = (e) => {
  if (e === void 0) return "";
  if (e === null) return "null";
  if (typeof e == "string") return e;
  if (typeof e == "boolean") return e ? "true" : "false";
  if (typeof e == "number") return e === 0 ? "0" : String(e);
  if (typeof e == "bigint") return String(e);
  const t = Tl(e), r = typeof t;
  if (r === "string" || r === "number" || r === "boolean" || r === "bigint")
    return String(t);
  if (r === "object")
    try {
      return JSON.stringify(t);
    } catch {
      return null;
    }
  return null;
}, Eo = (e, t) => {
  if (t === void 0) return e;
  if (t === null) return e + "null";
  const r = typeof t;
  if (r === "string" || r === "number" || r === "boolean" || r === "bigint")
    return e + String(t);
  if (Array.isArray(t))
    return e + t.join("\0");
  try {
    return e + JSON.stringify(t);
  } catch {
    return e + "?";
  }
}, dp = (e, t, r, n) => {
  let o = "";
  const s = /* @__PURE__ */ Object.create(null);
  for (let l = 0; l < e.length; l++) {
    const c = e[l];
    s[c] = 1;
    let u = t[c];
    r && r[c] !== void 0 && (u = r[c]);
    const d = ld(u);
    if (d === null) return null;
    o += c + ":" + d + ";";
  }
  const i = [];
  for (const l in t)
    l === "class" || l === "className" || s[l] || (s[l] = 1, i.push(l));
  if (r)
    for (const l in r)
      l === "class" || l === "className" || s[l] || r[l] === void 0 || (s[l] = 1, i.push(l));
  i.length > 1 && i.sort();
  for (let l = 0; l < i.length; l++) {
    const c = i[l];
    let u = t[c];
    r && r[c] !== void 0 && (u = r[c]);
    const d = ld(u);
    if (d === null) return null;
    o += c + ":" + d + ";";
  }
  return o;
}, fp = (e, t) => {
  let r = "";
  for (let n = 0; n < e.length; n++) {
    const { conditionKeys: o, source: s } = e[n];
    for (let i = 0; i < o.length; i++) {
      const l = o[i];
      r += l + "=", r = Eo(r, s[l]), r += ",";
    }
    r += "c=", r = Eo(r, s.class), r += "|cn=", r = Eo(r, s.className), r += ";";
  }
  for (let n = 0; n < t.length; n++) {
    const { conditionKeys: o, source: s } = t[n];
    for (let i = 0; i < o.length; i++) {
      const l = o[i];
      r += l + "=", r = Eo(r, s[l]), r += ",";
    }
    Array.isArray(s.slots) && (r += "slots=" + s.slots.join(",") + ","), r += "c=", r = Eo(r, s.class), r += "|cn=", r = Eo(r, s.className), r += ";";
  }
  return r;
}, hp = (e = up) => {
  let t = /* @__PURE__ */ new Map(), r = null;
  return {
    get(n) {
      if (t.has(n)) return t.get(n);
      if (r?.has(n)) {
        const o = r.get(n);
        return t.set(n, o), o;
      }
      return xo;
    },
    set(n, o) {
      t.size >= e && (r = t, t = /* @__PURE__ */ new Map()), t.set(n, o);
    }
  };
}, x0 = (e = up) => {
  const t = hp(e);
  return {
    get(r) {
      return t.get(r);
    },
    set(r, n) {
      t.set(r, n);
    }
  };
}, y0 = (e = m0) => {
  let t = /* @__PURE__ */ new Map(), r = null, n = 0;
  return {
    get(o, s) {
      const i = t.get(o);
      if (i) {
        const l = i.get(s);
        if (l !== void 0 || i.has(s)) return l;
      }
      if (r) {
        const l = r.get(o);
        if (l) {
          const c = l.get(s);
          if (c !== void 0 || l.has(s)) {
            let u = t.get(o);
            return u || (u = /* @__PURE__ */ new Map(), t.set(o, u)), u.has(s) || n++, u.set(s, c), c;
          }
        }
      }
      return xo;
    },
    set(o, s, i) {
      n >= e && (r = t, t = /* @__PURE__ */ new Map(), n = 0);
      let l = t.get(o);
      l || (l = /* @__PURE__ */ new Map(), t.set(o, l)), l.has(s) || n++, l.set(s, i);
    }
  };
}, Pc = (e, t) => {
  let r = null;
  return (n, o) => {
    if (!b0(o)) return n;
    const s = o.class, i = o.className;
    if (s != null && s !== "" && typeof s != "string" || i != null && i !== "" && typeof i != "string")
      return e(t, n, s, i);
    r ??= y0();
    const l = n ?? "", c = (typeof s == "string" ? s : "") + "\0" + (typeof i == "string" ? i : ""), u = r.get(l, c);
    if (u !== xo) return u;
    const d = e(t, n, s, i);
    return r.set(l, c, d), d;
  };
};
function _0() {
  let e = null, t = {}, r = !1;
  return {
    get cachedTwMerge() {
      return e;
    },
    set cachedTwMerge(n) {
      e = n;
    },
    get cachedTwMergeConfig() {
      return t;
    },
    set cachedTwMergeConfig(n) {
      t = n;
    },
    get didTwMergeConfigChange() {
      return r;
    },
    set didTwMergeConfigChange(n) {
      r = n;
    },
    reset() {
      e = null, t = {}, r = !1;
    }
  };
}
var Ht = _0(), w0 = (e) => {
  !_r(e.twMergeConfig) && !lp(e.twMergeConfig, Ht.cachedTwMergeConfig) && (Ht.didTwMergeConfigChange = !0, Ht.cachedTwMergeConfig = e.twMergeConfig);
}, k0 = (e, t) => {
  const r = [];
  for (let n = 0; n < t.length; n++) {
    const o = t[n], s = e[o];
    r.push({ key: o, values: s, isEmpty: _r(s) });
  }
  return r;
}, S0 = (e) => {
  if (!Array.isArray(e) || e.length === 0) return [];
  const t = [];
  for (let r = 0; r < e.length; r++) {
    const n = e[r], o = [];
    for (const s in n)
      s !== "class" && s !== "className" && o.push(s);
    t.push({ conditionKeys: o, source: n });
  }
  return t;
}, $0 = (e) => {
  if (!Array.isArray(e) || e.length === 0) return [];
  const t = [];
  for (let r = 0; r < e.length; r++) {
    const n = e[r], o = [];
    for (const s in n)
      s !== "slots" && s !== "class" && s !== "className" && o.push(s);
    t.push({ conditionKeys: o, source: n });
  }
  return t;
}, z0 = (e) => {
  const t = {};
  for (let r = 0; r < e.length; r++) {
    const n = e[r], o = n.source.slots;
    if (Array.isArray(o))
      for (let s = 0; s < o.length; s++) {
        const i = o[s];
        t[i] || (t[i] = []), t[i].push(n);
      }
  }
  return t;
}, A0 = (e, t) => {
  const {
    extend: r = null,
    slots: n = {},
    variants: o = {},
    compoundVariants: s = [],
    compoundSlots: i = [],
    defaultVariants: l = {}
  } = e, c = { ...g0, ...t }, u = e.slots !== void 0, d = r?.base ? Ii(r.base, e?.base) : e?.base, f = r?.variants && !_r(r.variants) ? Nc(o, r.variants) : o, h = r?.defaultVariants && !_r(r.defaultVariants) ? { ...r.defaultVariants, ...l } : l;
  w0(c);
  const p = !r?.slots || _r(r.slots), v = u ? p && r?.base ? Ii(e?.base, r.base) : typeof e?.base == "string" || e?.base == null ? e.base : Ii(e.base) : void 0, g = u ? {
    base: v,
    ...n
  } : {}, y = p ? g : v0(
    { ...r?.slots },
    _r(g) ? { base: e?.base } : g
  ), _ = !r?.compoundVariants || _r(r.compoundVariants) ? s : Cl(r?.compoundVariants, s), k = !r?.compoundSlots || _r(r.compoundSlots) ? i : Cl(r?.compoundSlots, i), S = Object.keys(f), b = _ && !Array.isArray(_) ? new TypeError(
    `The "compoundVariants" prop must be an array. Received: ${typeof _}`
  ) : k && !Array.isArray(k) ? new TypeError(
    `The "compoundSlots" prop must be an array. Received: ${typeof k}`
  ) : null, $ = u || !p ? "slots" : S.length === 0 ? "plain" : "variants";
  return {
    config: c,
    extend: r,
    base: d,
    variants: f,
    defaultVariants: h,
    slots: y,
    compoundVariants: _,
    compoundSlots: k,
    compiledVariants: null,
    compiledCompoundVariants: null,
    compiledCompoundSlots: null,
    compiledCompoundSlotsBySlot: null,
    deferredError: b,
    mode: $,
    slotKeys: null,
    variantKeys: S
  };
}, pp = (e) => (e.compiledVariants !== null || (e.compiledVariants = k0(e.variants, e.variantKeys), e.compiledCompoundVariants = S0(e.compoundVariants), e.compiledCompoundSlots = $0(e.compoundSlots), e.compiledCompoundSlotsBySlot = z0(e.compiledCompoundSlots), e.slotKeys = e.slots && typeof e.slots == "object" ? Object.keys(e.slots) : []), e), Ol = [], vp = [], E0 = [], M0 = [], T0 = [], gp = (e, t, r) => {
  const n = {};
  for (const o in e)
    n[o] = e[o];
  if (t)
    for (const o in t)
      t[o] !== void 0 && (n[o] = t[o]);
  if (r)
    for (const o in r)
      r[o] !== void 0 && (n[o] = r[o]);
  return n;
}, ci = (e) => e == null || e === !1, C0 = (e, t) => {
  if (!Array.isArray(e))
    return e === t || ci(e) && ci(t);
  for (let r = 0; r < e.length; r++) {
    const n = e[r];
    if (n === t || ci(n) && ci(t))
      return !0;
  }
  return !1;
}, mp = (e, t, r, n) => {
  if (e.isEmpty) return null;
  const o = n?.[e.key] ?? r?.[e.key];
  if (o === null) return null;
  const s = Tl(o);
  if (typeof s == "object") return null;
  const i = t?.[e.key], l = s ?? Tl(i);
  return e.values[l || "false"];
}, Ic = (e, t) => {
  const { conditionKeys: r, source: n } = e;
  for (let o = 0; o < r.length; o++) {
    const s = r[o];
    if (!C0(n[s], t[s])) return !1;
  }
  return !0;
}, cd = (e, t, r) => {
  typeof r == "string" ? t === "base" && e.push(r) : r && typeof r == "object" && r[t] && e.push(r[t]);
}, O0 = (e, t, r) => {
  const n = vp;
  n.length = 0;
  for (let o = 0; o < e.length; o++) {
    const s = mp(e[o], t, r);
    s && n.push(s);
  }
  return n;
}, N0 = (e, t, r, n, o) => {
  const s = vp;
  s.length = 0;
  for (let i = 0; i < t.length; i++) {
    const l = mp(t[i], r, n, o), c = e === "base" && typeof l == "string" ? l : l && l[e];
    c && s.push(c);
  }
  return s;
}, P0 = (e, t) => {
  const r = E0;
  r.length = 0;
  for (let n = 0; n < e.length; n++) {
    const o = e[n];
    Ic(o, t) && (o.source.class && r.push(o.source.class), o.source.className && r.push(o.source.className));
  }
  return r;
}, I0 = (e, t, r) => {
  const n = M0;
  n.length = 0;
  for (let o = 0; o < t.length; o++) {
    const s = t[o];
    Ic(s, r) && (cd(n, e, s.source.class), cd(n, e, s.source.className));
  }
  return n;
}, R0 = (e, t) => {
  const r = T0;
  r.length = 0;
  for (let n = 0; n < e.length; n++) {
    const o = e[n];
    Ic(o, t) && (o.source.class && r.push(o.source.class), o.source.className && r.push(o.source.className));
  }
  return r;
}, D0 = (e, t) => {
  const { base: r, config: n } = e;
  let o = xo;
  const s = Pc(t, n);
  return ((i) => (o === xo && (o = t(n, r)), s(o, i)));
}, L0 = (e, t) => {
  const { base: r, config: n, defaultVariants: o, deferredError: s, variantKeys: i } = e;
  let l = e.compiledCompoundVariants, c = e.compiledVariants, u = Ol, d = null;
  const f = Pc(t, n);
  let h = 1;
  const p = (v) => {
    const g = l.length > 0 ? P0(
      l,
      gp(o, v)
    ) : void 0;
    return t(
      n,
      r,
      O0(c, o, v),
      g
    );
  };
  return ((v) => {
    if (s) throw s;
    (c === null || l === null) && (pp(e), c = e.compiledVariants, l = e.compiledCompoundVariants, u = e.compiledCompoundSlots ?? Ol);
    let g;
    if (h > 0)
      h--, g = p(v);
    else {
      d ??= x0();
      const y = dp(i, o, v);
      if (y !== null) {
        const _ = l.length > 0 || u.length > 0 ? fp(l, u) : "", k = y + "#" + _, S = d.get(k);
        S !== xo ? g = S : (g = p(v), d.set(k, g));
      } else
        g = p(v);
    }
    return f(g, v);
  });
}, j0 = (e, t) => {
  const { config: r, defaultVariants: n, deferredError: o, slots: s, variantKeys: i } = e;
  let l = null, c = null, u = null, d = null, f = !1, h = null, p = null, v = 1;
  const g = () => {
    if (u !== null) return;
    (e.compiledVariants === null || e.compiledCompoundVariants === null || e.compiledCompoundSlots === null || e.compiledCompoundSlotsBySlot === null || e.slotKeys === null) && pp(e);
    const _ = e.compiledVariants;
    l = e.compiledCompoundVariants, c = e.compiledCompoundSlots;
    const k = e.compiledCompoundSlotsBySlot;
    u = e.slotKeys, f = l.length > 0 || c.length > 0, h = Pc(t, r);
    const S = new Array(u.length);
    for (let b = 0; b < u.length; b++) {
      const $ = u[b], E = k[$] ?? Ol;
      S[b] = (C, w) => {
        const O = f ? gp(n, C, w) : void 0, A = O ? I0($, l, O) : void 0, R = O ? R0(E, O) : void 0;
        return t(
          r,
          s[$],
          N0($, _, n, C, w),
          A,
          R
        );
      };
    }
    d = S;
  }, y = (_) => {
    const k = u, S = d, b = h, $ = {};
    for (let E = 0; E < k.length; E++) {
      const C = S[E], w = C(_);
      $[k[E]] = (O) => {
        if (O == null) return w;
        let A = !1;
        for (const R in O)
          if (!(R === "class" || R === "className") && O[R] !== void 0) {
            A = !0;
            break;
          }
        return b(A ? C(_, O) : w, O);
      };
    }
    return $;
  };
  return ((_) => {
    if (o) throw o;
    if (g(), v > 0)
      return v--, y(_);
    const k = dp(i, n, _);
    if (k === null)
      return y(_);
    const S = f ? fp(l, c) : "", b = k + "#" + S;
    p ??= hp();
    const $ = p.get(b);
    if ($ !== xo) return $;
    const E = y(_);
    return p.set(b, E), E;
  });
}, V0 = (e, t) => {
  if (e.mode === "plain") return D0(e, t);
  let r;
  return ((n) => (r ??= e.mode === "slots" ? j0(e, t) : L0(e, t), r(n)));
}, F0 = (e, t) => {
  e.variantKeys = t.variantKeys, e.extend = t.extend, e.base = t.base, e.slots = t.slots, e.variants = t.variants, e.defaultVariants = t.defaultVariants, e.compoundSlots = t.compoundSlots, e.compoundVariants = t.compoundVariants;
}, Z0 = (e) => {
  const t = (n, o) => {
    const s = A0(n, o), i = V0(s, e);
    return F0(i, s), i;
  };
  return {
    tv: t,
    createTV: (n) => (o, s) => t(o, s ? Nc(n, s) : n)
  };
}, U0 = (e, t) => {
  const r = e.length, n = t.length, o = new Array(r + n);
  for (let s = 0; s < r; s++) o[s] = e[s];
  for (let s = 0; s < n; s++) o[r + s] = t[s];
  return o;
}, B0 = (e, t) => ({
  classGroupId: e,
  validator: t
}), bp = (e = /* @__PURE__ */ new Map(), t = null, r) => ({
  nextPart: e,
  validators: t,
  classGroupId: r
}), Ji = "-", ud = [], W0 = "arbitrary..", H0 = (e) => {
  const t = G0(e), { conflictingClassGroups: r, conflictingClassGroupModifiers: n } = e;
  return {
    getClassGroupId: (i) => {
      if (i[0] === "[" && i[i.length - 1] === "]")
        return q0(i);
      const l = i.split(Ji), c = l[0] === "" && l.length > 1 ? 1 : 0;
      return xp(l, c, t);
    },
    getConflictingClassGroupIds: (i, l) => {
      if (l) {
        const c = n[i], u = r[i];
        return c ? u ? U0(u, c) : c : u || ud;
      }
      return r[i] || ud;
    }
  };
}, xp = (e, t, r) => {
  if (e.length - t === 0)
    return r.classGroupId;
  const o = e[t], s = r.nextPart.get(o);
  if (s) {
    const u = xp(e, t + 1, s);
    if (u) return u;
  }
  const i = r.validators;
  if (i === null)
    return;
  const l = t === 0 ? e.join(Ji) : e.slice(t).join(Ji), c = i.length;
  for (let u = 0; u < c; u++) {
    const d = i[u];
    if (d.validator(l))
      return d.classGroupId;
  }
}, q0 = (e) => {
  const t = e.slice(1, -1), r = t.indexOf(":");
  if (r === -1)
    return;
  const n = t.slice(0, r);
  return n ? W0 + n : void 0;
}, G0 = (e) => {
  const { theme: t, classGroups: r } = e;
  return K0(r, t);
}, K0 = (e, t) => {
  const r = bp();
  for (const n in e) {
    const o = e[n];
    Rc(o, r, n, t);
  }
  return r;
}, Rc = (e, t, r, n) => {
  const o = e.length;
  for (let s = 0; s < o; s++) {
    const i = e[s];
    Y0(i, t, r, n);
  }
}, Y0 = (e, t, r, n) => {
  if (typeof e == "string") {
    X0(e, t, r);
    return;
  }
  if (typeof e == "function") {
    J0(e, t, r, n);
    return;
  }
  Q0(
    e,
    t,
    r,
    n
  );
}, X0 = (e, t, r) => {
  const n = e === "" ? t : yp(t, e);
  n.classGroupId = r;
}, J0 = (e, t, r, n) => {
  if (e1(e)) {
    Rc(e(n), t, r, n);
    return;
  }
  t.validators === null && (t.validators = []), t.validators.push(
    B0(r, e)
  );
}, Q0 = (e, t, r, n) => {
  const o = Object.entries(e), s = o.length;
  for (let i = 0; i < s; i++) {
    const [l, c] = o[i];
    Rc(c, yp(t, l), r, n);
  }
}, yp = (e, t) => {
  let r = e;
  const n = t.split(Ji), o = n.length;
  for (let s = 0; s < o; s++) {
    const i = n[s];
    let l = r.nextPart.get(i);
    l || (l = bp(), r.nextPart.set(i, l)), r = l;
  }
  return r;
}, e1 = (e) => "isThemeGetter" in e && e.isThemeGetter === !0, t1 = "!", r1 = 58, n1 = 47, o1 = 91, s1 = 93, i1 = 40, a1 = 41, dd = 33, l1 = (e, t, r, n) => ({
  modifiers: e,
  hasImportantModifier: t,
  baseClassName: r,
  maybePostfixModifierPosition: n,
  isExternal: void 0
}), fd = (e) => {
  const t = [];
  let r = 0, n = 0, o = 0, s;
  const i = e.length;
  for (let h = 0; h < i; h++) {
    const p = e.charCodeAt(h);
    if (r === 0 && n === 0) {
      if (p === r1) {
        t.push(e.slice(o, h)), o = h + 1;
        continue;
      }
      if (p === n1) {
        s = h;
        continue;
      }
    }
    p === o1 ? r++ : p === s1 ? r-- : p === i1 ? n++ : p === a1 && n--;
  }
  const l = t.length === 0 ? e : e.slice(o);
  let c = l, u = !1;
  const d = l.length - 1;
  l.charCodeAt(d) === dd ? (c = l.slice(0, -1), u = !0) : (
    // Tailwind CSS v3: important modifier at the start of the base class (legacy).
    l.charCodeAt(0) === dd && (c = l.slice(1), u = !0)
  );
  const f = s && s > o ? s - o : void 0;
  return l1(
    t,
    u,
    c,
    f
  );
}, c1 = (e) => {
  const t = new Set(e.orderSensitiveModifiers);
  return (r) => {
    const n = [];
    let o = [];
    for (let s = 0; s < r.length; s++) {
      const i = r[s], l = i[0] === "[", c = t.has(i);
      if (l || c) {
        if (o.length > 0) {
          o.sort();
          for (let u = 0; u < o.length; u++)
            n.push(o[u]);
          o = [];
        }
        n.push(i);
      } else
        o.push(i);
    }
    if (o.length > 0) {
      o.sort();
      for (let s = 0; s < o.length; s++)
        n.push(o[s]);
    }
    return n;
  };
}, Ya = { isExternal: !0, classId: -1, conflictIds: [] }, u1 = 4096, d1 = 16384, f1 = (e) => {
  const t = c1(e), r = h1(e), { getClassGroupId: n, getConflictingClassGroupIds: o } = H0(e);
  let s = /* @__PURE__ */ Object.create(null), i = /* @__PURE__ */ Object.create(null), l = 0, c = new Int32Array(256), u = 0, d = new Uint8Array(64), f = !1;
  const h = (S) => {
    const b = [], $ = S.length;
    let E = -1;
    f = !1;
    for (let C = 0; C < $; C++) {
      const w = S.charCodeAt(C);
      w === 32 ? E !== -1 && (b.push(S.slice(E, C)), E = -1) : w >= 9 && w <= 13 ? (f = !0, E !== -1 && (b.push(S.slice(E, C)), E = -1)) : E === -1 && (E = C);
    }
    return E !== -1 && b.push(S.slice(E)), b;
  }, p = /* @__PURE__ */ new Map();
  let v = 0;
  const g = (S) => {
    let b = p.get(S);
    if (b === void 0 && (b = v++, p.set(S, b), b >= c.length)) {
      const $ = new Int32Array(c.length * 2);
      $.set(c), c = $;
    }
    return b;
  }, y = (S) => {
    const {
      isExternal: b,
      modifiers: $,
      hasImportantModifier: E,
      baseClassName: C,
      maybePostfixModifierPosition: w
    } = fd(S);
    if (b)
      return Ya;
    let O = !!w, A;
    if (O) {
      const H = C.substring(0, w);
      A = n(H);
      const V = A && r[A] ? n(C) : void 0;
      V && V !== A && (A = V, O = !1);
    } else
      A = n(C);
    if (!A) {
      if (!O || (A = n(C), !A))
        return Ya;
      O = !1;
    }
    const R = $.length === 0 ? "" : $.length === 1 ? $[0] : t($).join(":"), W = E ? R + t1 : R, q = o(A, O), P = [];
    for (let H = 0; H < q.length; H++)
      P.push(g(W + q[H]));
    return {
      isExternal: !1,
      classId: g(W + A),
      conflictIds: P
    };
  }, _ = (S) => {
    let b = s[S];
    return b !== void 0 || (b = i[S], b === void 0 && (b = y(S)), s[S] = b, ++l > u1 && (l = 0, i = s, s = /* @__PURE__ */ Object.create(null))), b;
  };
  return {
    parseClassName: fd,
    sortModifiers: t,
    postfixLookupClassGroupIds: r,
    getClassGroupId: n,
    getConflictingClassGroupIds: o,
    getClassDescriptor: _,
    mergeClassList: (S) => {
      const b = h(S), $ = b.length;
      if ($ === 1)
        return b[0];
      v > d1 && (p.clear(), v = 0, s = /* @__PURE__ */ Object.create(null), i = /* @__PURE__ */ Object.create(null), l = 0), u = u + 1 | 0, u === 0 && (u = 1);
      const E = u;
      if ($ > d.length) {
        let A = d.length;
        for (; A < $; ) A *= 2;
        d = new Uint8Array(A);
      }
      let C = !1, w = 0;
      for (let A = $ - 1; A >= 0; A -= 1) {
        const R = b[A];
        w += R.length;
        const W = _(R);
        if (W.isExternal) {
          d[A] = 1;
          continue;
        }
        const q = W.classId;
        if (c[q] === E) {
          d[A] = 0, C = !0;
          continue;
        }
        c[q] = E;
        const P = W.conflictIds;
        for (let H = 0; H < P.length; H++)
          c[P[H]] = E;
        d[A] = 1;
      }
      if (!C && !f && S.length === w + $ - 1)
        return S;
      let O = "";
      for (let A = 0; A < $; A++)
        d[A] === 1 && (O && (O += " "), O += b[A]);
      return O;
    }
  };
}, h1 = (e) => {
  const t = /* @__PURE__ */ Object.create(null), r = e.postfixLookupClassGroups;
  if (r)
    for (let n = 0; n < r.length; n++)
      t[r[n]] = !0;
  return t;
}, p1 = 500, hd = (e) => {
  let t, r, n = /* @__PURE__ */ Object.create(null), o = /* @__PURE__ */ Object.create(null), s = 0;
  const i = (u) => (t = f1(e()), r = t.mergeClassList, c.mergeString = l, l(u)), l = (u) => {
    let d = n[u];
    return d !== void 0 || (d = o[u], d === void 0 && (d = r(u)), n[u] = d, ++s > p1 && (s = 0, o = n, n = /* @__PURE__ */ Object.create(null))), d;
  }, c = (...u) => c.mergeString(_a(u));
  return c.mergeString = i, c;
}, v1 = [], Nt = (e) => {
  const t = (r) => r[e] || v1;
  return t.isThemeGetter = !0, t;
}, _p = /^\[(?:(\w[\w-]*):)?(.+)\]$/i, wp = /^\((?:(\w[\w-]*):)?(.+)\)$/i, g1 = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/, m1 = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/, b1 = /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/, x1 = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/, y1 = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/, _1 = /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/, kp = Number, w1 = Number.isNaN, k1 = Number.isInteger, Pn = (e) => g1.test(e), tt = (e) => !!e && !w1(kp(e)), qr = (e) => !!e && k1(kp(e)), Xa = (e) => e.endsWith("%") && tt(e.slice(0, -1)), cn = (e) => m1.test(e), Sp = () => !0, S1 = (e) => (
  // `colorFunctionRegex` check is necessary because color functions can have percentages in them which which would be incorrectly classified as lengths.
  // For example, `hsl(0 0% 0%)` would be classified as a length without this check.
  // I could also use lookbehind assertion in `lengthUnitRegex` but that isn't supported widely enough.
  b1.test(e) && !x1.test(e)
), Dc = () => !1, $1 = (e) => y1.test(e), z1 = (e) => _1.test(e), A1 = (e) => !Ce(e) && !Ne(e), E1 = (e) => e.startsWith("@container") && (e[10] === "/" && e[11] !== void 0 || e[11] === "s" && e[16] !== void 0 && e.startsWith("-size/", 10) || e[11] === "n" && e[18] !== void 0 && e.startsWith("-normal/", 10)), M1 = (e) => Xn(e, Ap, Dc), Ce = (e) => _p.test(e), oo = (e) => Xn(e, Ep, S1), pd = (e) => Xn(e, D1, tt), T1 = (e) => Xn(e, Tp, Sp), C1 = (e) => Xn(e, Mp, Dc), vd = (e) => Xn(e, $p, Dc), O1 = (e) => Xn(e, zp, z1), ui = (e) => Xn(e, Cp, $1), Ne = (e) => wp.test(e), us = (e) => So(e, Ep), N1 = (e) => So(e, Mp), gd = (e) => So(e, $p), P1 = (e) => So(e, Ap), I1 = (e) => So(e, zp), di = (e) => So(e, Cp, !0), R1 = (e) => So(e, Tp, !0), Xn = (e, t, r) => {
  const n = _p.exec(e);
  return n ? n[1] ? t(n[1]) : r(n[2]) : !1;
}, So = (e, t, r = !1) => {
  const n = wp.exec(e);
  return n ? n[1] ? t(n[1]) : r : !1;
}, $p = (e) => e === "position" || e === "percentage", zp = (e) => e === "image" || e === "url", Ap = (e) => e === "length" || e === "size" || e === "bg-size", Ep = (e) => e === "length", D1 = (e) => e === "number", Mp = (e) => e === "family-name", Tp = (e) => e === "number" || e === "weight", Cp = (e) => e === "shadow", Ja = () => {
  const e = Nt("color"), t = Nt("font"), r = Nt("text"), n = Nt("font-weight"), o = Nt("tracking"), s = Nt("leading"), i = Nt("breakpoint"), l = Nt("container"), c = Nt("spacing"), u = Nt("radius"), d = Nt("shadow"), f = Nt("inset-shadow"), h = Nt("text-shadow"), p = Nt("drop-shadow"), v = Nt("blur"), g = Nt("perspective"), y = Nt("aspect"), _ = Nt("ease"), k = Nt("animate"), S = () => ["auto", "avoid", "all", "avoid-page", "page", "left", "right", "column"], b = () => [
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "top-left",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "left-top",
    "top-right",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "right-top",
    "bottom-right",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "right-bottom",
    "bottom-left",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "left-bottom"
  ], $ = () => [...b(), Ne, Ce], E = () => ["auto", "hidden", "clip", "visible", "scroll"], C = () => ["auto", "contain", "none"], w = () => [Ne, Ce, c], O = () => [Pn, "full", "auto", ...w()], A = () => [qr, "none", "subgrid", Ne, Ce], R = () => [
    "auto",
    { span: ["full", qr, Ne, Ce] },
    qr,
    Ne,
    Ce
  ], W = () => [qr, "auto", Ne, Ce], q = () => ["auto", "min", "max", "fr", Ne, Ce], P = () => [
    "start",
    "end",
    "center",
    "between",
    "around",
    "evenly",
    "stretch",
    "baseline",
    "center-safe",
    "end-safe"
  ], H = () => ["start", "end", "center", "stretch", "center-safe", "end-safe"], V = () => ["auto", ...w()], Y = () => [
    Pn,
    "auto",
    "full",
    "dvw",
    "dvh",
    "lvw",
    "lvh",
    "svw",
    "svh",
    "min",
    "max",
    "fit",
    ...w()
  ], oe = () => [
    Pn,
    "screen",
    "full",
    "dvw",
    "lvw",
    "svw",
    "min",
    "max",
    "fit",
    ...w()
  ], X = () => [
    Pn,
    "screen",
    "full",
    "lh",
    "dvh",
    "lvh",
    "svh",
    "min",
    "max",
    "fit",
    ...w()
  ], I = () => [e, Ne, Ce], te = () => [
    ...b(),
    gd,
    vd,
    { position: [Ne, Ce] }
  ], F = () => ["no-repeat", { repeat: ["", "x", "y", "space", "round"] }], Q = () => [
    "auto",
    "cover",
    "contain",
    P1,
    M1,
    { size: [Ne, Ce] }
  ], pe = () => [Xa, us, oo], fe = () => [
    // Deprecated since Tailwind CSS v4.0.0
    "",
    "none",
    "full",
    u,
    Ne,
    Ce
  ], G = () => ["", tt, us, oo], ve = () => ["solid", "dashed", "dotted", "double"], ke = () => [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity"
  ], se = () => [tt, Xa, gd, vd], ye = () => [
    // Deprecated since Tailwind CSS v4.0.0
    "",
    "none",
    v,
    Ne,
    Ce
  ], U = () => ["none", tt, Ne, Ce], ee = () => ["none", tt, Ne, Ce], ue = () => [tt, Ne, Ce], me = () => [Pn, "full", ...w()];
  return {
    theme: {
      animate: ["spin", "ping", "pulse", "bounce"],
      aspect: ["video"],
      blur: [cn],
      breakpoint: [cn],
      color: [Sp],
      container: [cn],
      "drop-shadow": [cn],
      ease: ["in", "out", "in-out"],
      font: [A1],
      "font-weight": [
        "thin",
        "extralight",
        "light",
        "normal",
        "medium",
        "semibold",
        "bold",
        "extrabold",
        "black"
      ],
      "inset-shadow": [cn],
      leading: ["none", "tight", "snug", "normal", "relaxed", "loose"],
      perspective: ["dramatic", "near", "normal", "midrange", "distant", "none"],
      radius: [cn],
      shadow: [cn],
      spacing: ["px", tt],
      text: [cn],
      "text-shadow": [cn],
      tracking: ["tighter", "tight", "normal", "wide", "wider", "widest"]
    },
    classGroups: {
      // --------------
      // --- Layout ---
      // --------------
      /**
       * Aspect Ratio
       * @see https://tailwindcss.com/docs/aspect-ratio
       */
      aspect: [
        {
          aspect: [
            "auto",
            "square",
            Pn,
            Ce,
            Ne,
            y
          ]
        }
      ],
      /**
       * Container
       * @see https://tailwindcss.com/docs/container
       * @deprecated since Tailwind CSS v4.0.0
       */
      container: ["container"],
      /**
       * Container Type
       * @see https://tailwindcss.com/docs/responsive-design#container-queries
       */
      "container-type": [
        { "@container": ["", "normal", "size", Ne, Ce] }
      ],
      /**
       * Container Name
       * @see https://tailwindcss.com/docs/responsive-design#named-containers
       */
      "container-named": [E1],
      /**
       * Columns
       * @see https://tailwindcss.com/docs/columns
       */
      columns: [{ columns: [tt, Ce, Ne, l] }],
      /**
       * Break After
       * @see https://tailwindcss.com/docs/break-after
       */
      "break-after": [{ "break-after": S() }],
      /**
       * Break Before
       * @see https://tailwindcss.com/docs/break-before
       */
      "break-before": [{ "break-before": S() }],
      /**
       * Break Inside
       * @see https://tailwindcss.com/docs/break-inside
       */
      "break-inside": [{ "break-inside": ["auto", "avoid", "avoid-page", "avoid-column"] }],
      /**
       * Box Decoration Break
       * @see https://tailwindcss.com/docs/box-decoration-break
       */
      "box-decoration": [{ "box-decoration": ["slice", "clone"] }],
      /**
       * Box Sizing
       * @see https://tailwindcss.com/docs/box-sizing
       */
      box: [{ box: ["border", "content"] }],
      /**
       * Display
       * @see https://tailwindcss.com/docs/display
       */
      display: [
        "block",
        "inline-block",
        "inline",
        "flex",
        "inline-flex",
        "table",
        "inline-table",
        "table-caption",
        "table-cell",
        "table-column",
        "table-column-group",
        "table-footer-group",
        "table-header-group",
        "table-row-group",
        "table-row",
        "flow-root",
        "grid",
        "inline-grid",
        "contents",
        "list-item",
        "hidden"
      ],
      /**
       * Screen Reader Only
       * @see https://tailwindcss.com/docs/display#screen-reader-only
       */
      sr: ["sr-only", "not-sr-only"],
      /**
       * Floats
       * @see https://tailwindcss.com/docs/float
       */
      float: [{ float: ["right", "left", "none", "start", "end"] }],
      /**
       * Clear
       * @see https://tailwindcss.com/docs/clear
       */
      clear: [{ clear: ["left", "right", "both", "none", "start", "end"] }],
      /**
       * Isolation
       * @see https://tailwindcss.com/docs/isolation
       */
      isolation: ["isolate", "isolation-auto"],
      /**
       * Object Fit
       * @see https://tailwindcss.com/docs/object-fit
       */
      "object-fit": [{ object: ["contain", "cover", "fill", "none", "scale-down"] }],
      /**
       * Object Position
       * @see https://tailwindcss.com/docs/object-position
       */
      "object-position": [{ object: $() }],
      /**
       * Overflow
       * @see https://tailwindcss.com/docs/overflow
       */
      overflow: [{ overflow: E() }],
      /**
       * Overflow X
       * @see https://tailwindcss.com/docs/overflow
       */
      "overflow-x": [{ "overflow-x": E() }],
      /**
       * Overflow Y
       * @see https://tailwindcss.com/docs/overflow
       */
      "overflow-y": [{ "overflow-y": E() }],
      /**
       * Overscroll Behavior
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      overscroll: [{ overscroll: C() }],
      /**
       * Overscroll Behavior X
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      "overscroll-x": [{ "overscroll-x": C() }],
      /**
       * Overscroll Behavior Y
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      "overscroll-y": [{ "overscroll-y": C() }],
      /**
       * Position
       * @see https://tailwindcss.com/docs/position
       */
      position: ["static", "fixed", "absolute", "relative", "sticky"],
      /**
       * Inset
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      inset: [{ inset: O() }],
      /**
       * Inset Inline
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-x": [{ "inset-x": O() }],
      /**
       * Inset Block
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-y": [{ "inset-y": O() }],
      /**
       * Inset Inline Start
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       * @todo class group will be renamed to `inset-s` in next major release
       */
      start: [
        {
          "inset-s": O(),
          /**
           * @deprecated since Tailwind CSS v4.2.0 in favor of `inset-s-*` utilities.
           * @see https://github.com/tailwindlabs/tailwindcss/pull/19613
           */
          start: O()
        }
      ],
      /**
       * Inset Inline End
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       * @todo class group will be renamed to `inset-e` in next major release
       */
      end: [
        {
          "inset-e": O(),
          /**
           * @deprecated since Tailwind CSS v4.2.0 in favor of `inset-e-*` utilities.
           * @see https://github.com/tailwindlabs/tailwindcss/pull/19613
           */
          end: O()
        }
      ],
      /**
       * Inset Block Start
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-bs": [{ "inset-bs": O() }],
      /**
       * Inset Block End
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-be": [{ "inset-be": O() }],
      /**
       * Top
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      top: [{ top: O() }],
      /**
       * Right
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      right: [{ right: O() }],
      /**
       * Bottom
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      bottom: [{ bottom: O() }],
      /**
       * Left
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      left: [{ left: O() }],
      /**
       * Visibility
       * @see https://tailwindcss.com/docs/visibility
       */
      visibility: ["visible", "invisible", "collapse"],
      /**
       * Z-Index
       * @see https://tailwindcss.com/docs/z-index
       */
      z: [{ z: [qr, "auto", Ne, Ce] }],
      // ------------------------
      // --- Flexbox and Grid ---
      // ------------------------
      /**
       * Flex Basis
       * @see https://tailwindcss.com/docs/flex-basis
       */
      basis: [
        {
          basis: [Pn, "full", "auto", l, ...w()]
        }
      ],
      /**
       * Flex Direction
       * @see https://tailwindcss.com/docs/flex-direction
       */
      "flex-direction": [{ flex: ["row", "row-reverse", "col", "col-reverse"] }],
      /**
       * Flex Wrap
       * @see https://tailwindcss.com/docs/flex-wrap
       */
      "flex-wrap": [{ flex: ["nowrap", "wrap", "wrap-reverse"] }],
      /**
       * Flex
       * @see https://tailwindcss.com/docs/flex
       */
      flex: [{ flex: [tt, Pn, "auto", "initial", "none", Ce] }],
      /**
       * Flex Grow
       * @see https://tailwindcss.com/docs/flex-grow
       */
      grow: [{ grow: ["", tt, Ne, Ce] }],
      /**
       * Flex Shrink
       * @see https://tailwindcss.com/docs/flex-shrink
       */
      shrink: [{ shrink: ["", tt, Ne, Ce] }],
      /**
       * Order
       * @see https://tailwindcss.com/docs/order
       */
      order: [
        {
          order: [qr, "first", "last", "none", Ne, Ce]
        }
      ],
      /**
       * Grid Template Columns
       * @see https://tailwindcss.com/docs/grid-template-columns
       */
      "grid-cols": [{ "grid-cols": A() }],
      /**
       * Grid Column Start / End
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-start-end": [{ col: R() }],
      /**
       * Grid Column Start
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-start": [{ "col-start": W() }],
      /**
       * Grid Column End
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-end": [{ "col-end": W() }],
      /**
       * Grid Template Rows
       * @see https://tailwindcss.com/docs/grid-template-rows
       */
      "grid-rows": [{ "grid-rows": A() }],
      /**
       * Grid Row Start / End
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-start-end": [{ row: R() }],
      /**
       * Grid Row Start
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-start": [{ "row-start": W() }],
      /**
       * Grid Row End
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-end": [{ "row-end": W() }],
      /**
       * Grid Auto Flow
       * @see https://tailwindcss.com/docs/grid-auto-flow
       */
      "grid-flow": [{ "grid-flow": ["row", "col", "dense", "row-dense", "col-dense"] }],
      /**
       * Grid Auto Columns
       * @see https://tailwindcss.com/docs/grid-auto-columns
       */
      "auto-cols": [{ "auto-cols": q() }],
      /**
       * Grid Auto Rows
       * @see https://tailwindcss.com/docs/grid-auto-rows
       */
      "auto-rows": [{ "auto-rows": q() }],
      /**
       * Gap
       * @see https://tailwindcss.com/docs/gap
       */
      gap: [{ gap: w() }],
      /**
       * Gap X
       * @see https://tailwindcss.com/docs/gap
       */
      "gap-x": [{ "gap-x": w() }],
      /**
       * Gap Y
       * @see https://tailwindcss.com/docs/gap
       */
      "gap-y": [{ "gap-y": w() }],
      /**
       * Justify Content
       * @see https://tailwindcss.com/docs/justify-content
       */
      "justify-content": [{ justify: [...P(), "normal"] }],
      /**
       * Justify Items
       * @see https://tailwindcss.com/docs/justify-items
       */
      "justify-items": [{ "justify-items": [...H(), "normal"] }],
      /**
       * Justify Self
       * @see https://tailwindcss.com/docs/justify-self
       */
      "justify-self": [{ "justify-self": ["auto", ...H()] }],
      /**
       * Align Content
       * @see https://tailwindcss.com/docs/align-content
       */
      "align-content": [{ content: ["normal", ...P()] }],
      /**
       * Align Items
       * @see https://tailwindcss.com/docs/align-items
       */
      "align-items": [{ items: [...H(), { baseline: ["", "last"] }] }],
      /**
       * Align Self
       * @see https://tailwindcss.com/docs/align-self
       */
      "align-self": [{ self: ["auto", ...H(), { baseline: ["", "last"] }] }],
      /**
       * Place Content
       * @see https://tailwindcss.com/docs/place-content
       */
      "place-content": [{ "place-content": P() }],
      /**
       * Place Items
       * @see https://tailwindcss.com/docs/place-items
       */
      "place-items": [{ "place-items": [...H(), "baseline"] }],
      /**
       * Place Self
       * @see https://tailwindcss.com/docs/place-self
       */
      "place-self": [{ "place-self": ["auto", ...H()] }],
      // Spacing
      /**
       * Padding
       * @see https://tailwindcss.com/docs/padding
       */
      p: [{ p: w() }],
      /**
       * Padding Inline
       * @see https://tailwindcss.com/docs/padding
       */
      px: [{ px: w() }],
      /**
       * Padding Block
       * @see https://tailwindcss.com/docs/padding
       */
      py: [{ py: w() }],
      /**
       * Padding Inline Start
       * @see https://tailwindcss.com/docs/padding
       */
      ps: [{ ps: w() }],
      /**
       * Padding Inline End
       * @see https://tailwindcss.com/docs/padding
       */
      pe: [{ pe: w() }],
      /**
       * Padding Block Start
       * @see https://tailwindcss.com/docs/padding
       */
      pbs: [{ pbs: w() }],
      /**
       * Padding Block End
       * @see https://tailwindcss.com/docs/padding
       */
      pbe: [{ pbe: w() }],
      /**
       * Padding Top
       * @see https://tailwindcss.com/docs/padding
       */
      pt: [{ pt: w() }],
      /**
       * Padding Right
       * @see https://tailwindcss.com/docs/padding
       */
      pr: [{ pr: w() }],
      /**
       * Padding Bottom
       * @see https://tailwindcss.com/docs/padding
       */
      pb: [{ pb: w() }],
      /**
       * Padding Left
       * @see https://tailwindcss.com/docs/padding
       */
      pl: [{ pl: w() }],
      /**
       * Margin
       * @see https://tailwindcss.com/docs/margin
       */
      m: [{ m: V() }],
      /**
       * Margin Inline
       * @see https://tailwindcss.com/docs/margin
       */
      mx: [{ mx: V() }],
      /**
       * Margin Block
       * @see https://tailwindcss.com/docs/margin
       */
      my: [{ my: V() }],
      /**
       * Margin Inline Start
       * @see https://tailwindcss.com/docs/margin
       */
      ms: [{ ms: V() }],
      /**
       * Margin Inline End
       * @see https://tailwindcss.com/docs/margin
       */
      me: [{ me: V() }],
      /**
       * Margin Block Start
       * @see https://tailwindcss.com/docs/margin
       */
      mbs: [{ mbs: V() }],
      /**
       * Margin Block End
       * @see https://tailwindcss.com/docs/margin
       */
      mbe: [{ mbe: V() }],
      /**
       * Margin Top
       * @see https://tailwindcss.com/docs/margin
       */
      mt: [{ mt: V() }],
      /**
       * Margin Right
       * @see https://tailwindcss.com/docs/margin
       */
      mr: [{ mr: V() }],
      /**
       * Margin Bottom
       * @see https://tailwindcss.com/docs/margin
       */
      mb: [{ mb: V() }],
      /**
       * Margin Left
       * @see https://tailwindcss.com/docs/margin
       */
      ml: [{ ml: V() }],
      /**
       * Space Between X
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-x": [{ "space-x": w() }],
      /**
       * Space Between X Reverse
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-x-reverse": ["space-x-reverse"],
      /**
       * Space Between Y
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-y": [{ "space-y": w() }],
      /**
       * Space Between Y Reverse
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-y-reverse": ["space-y-reverse"],
      // --------------
      // --- Sizing ---
      // --------------
      /**
       * Size
       * @see https://tailwindcss.com/docs/width#setting-both-width-and-height
       */
      size: [{ size: Y() }],
      /**
       * Inline Size
       * @see https://tailwindcss.com/docs/width
       */
      "inline-size": [{ inline: ["auto", ...oe()] }],
      /**
       * Min-Inline Size
       * @see https://tailwindcss.com/docs/min-width
       */
      "min-inline-size": [{ "min-inline": ["auto", ...oe()] }],
      /**
       * Max-Inline Size
       * @see https://tailwindcss.com/docs/max-width
       */
      "max-inline-size": [{ "max-inline": ["none", ...oe()] }],
      /**
       * Block Size
       * @see https://tailwindcss.com/docs/height
       */
      "block-size": [{ block: ["auto", ...X()] }],
      /**
       * Min-Block Size
       * @see https://tailwindcss.com/docs/min-height
       */
      "min-block-size": [{ "min-block": ["auto", ...X()] }],
      /**
       * Max-Block Size
       * @see https://tailwindcss.com/docs/max-height
       */
      "max-block-size": [{ "max-block": ["none", ...X()] }],
      /**
       * Width
       * @see https://tailwindcss.com/docs/width
       */
      w: [{ w: [l, "screen", ...Y()] }],
      /**
       * Min-Width
       * @see https://tailwindcss.com/docs/min-width
       */
      "min-w": [
        {
          "min-w": [
            l,
            "screen",
            /** Deprecated. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
            "none",
            ...Y()
          ]
        }
      ],
      /**
       * Max-Width
       * @see https://tailwindcss.com/docs/max-width
       */
      "max-w": [
        {
          "max-w": [
            l,
            "screen",
            "none",
            /** Deprecated since Tailwind CSS v4.0.0. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
            "prose",
            /** Deprecated since Tailwind CSS v4.0.0. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
            { screen: [i] },
            ...Y()
          ]
        }
      ],
      /**
       * Height
       * @see https://tailwindcss.com/docs/height
       */
      h: [{ h: ["screen", "lh", ...Y()] }],
      /**
       * Min-Height
       * @see https://tailwindcss.com/docs/min-height
       */
      "min-h": [{ "min-h": ["screen", "lh", "none", ...Y()] }],
      /**
       * Max-Height
       * @see https://tailwindcss.com/docs/max-height
       */
      "max-h": [{ "max-h": ["screen", "lh", ...Y()] }],
      // ------------------
      // --- Typography ---
      // ------------------
      /**
       * Font Size
       * @see https://tailwindcss.com/docs/font-size
       */
      "font-size": [{ text: ["base", r, us, oo] }],
      /**
       * Font Smoothing
       * @see https://tailwindcss.com/docs/font-smoothing
       */
      "font-smoothing": ["antialiased", "subpixel-antialiased"],
      /**
       * Font Style
       * @see https://tailwindcss.com/docs/font-style
       */
      "font-style": ["italic", "not-italic"],
      /**
       * Font Weight
       * @see https://tailwindcss.com/docs/font-weight
       */
      "font-weight": [
        {
          font: [n, R1, T1]
        }
      ],
      /**
       * Font Stretch
       * @see https://tailwindcss.com/docs/font-stretch
       */
      "font-stretch": [
        {
          "font-stretch": [
            "ultra-condensed",
            "extra-condensed",
            "condensed",
            "semi-condensed",
            "normal",
            "semi-expanded",
            "expanded",
            "extra-expanded",
            "ultra-expanded",
            Xa,
            Ce
          ]
        }
      ],
      /**
       * Font Family
       * @see https://tailwindcss.com/docs/font-family
       */
      "font-family": [{ font: [N1, C1, t] }],
      /**
       * Font Feature Settings
       * @see https://tailwindcss.com/docs/font-feature-settings
       */
      "font-features": [{ "font-features": [Ce] }],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-normal": ["normal-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-ordinal": ["ordinal"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-slashed-zero": ["slashed-zero"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-figure": ["lining-nums", "oldstyle-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-spacing": ["proportional-nums", "tabular-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-fraction": ["diagonal-fractions", "stacked-fractions"],
      /**
       * Letter Spacing
       * @see https://tailwindcss.com/docs/letter-spacing
       */
      tracking: [{ tracking: [o, Ne, Ce] }],
      /**
       * Line Clamp
       * @see https://tailwindcss.com/docs/line-clamp
       */
      "line-clamp": [{ "line-clamp": [tt, "none", Ne, pd] }],
      /**
       * Line Height
       * @see https://tailwindcss.com/docs/line-height
       */
      leading: [
        {
          leading: [
            /** Deprecated since Tailwind CSS v4.0.0. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
            s,
            ...w()
          ]
        }
      ],
      /**
       * List Style Image
       * @see https://tailwindcss.com/docs/list-style-image
       */
      "list-image": [{ "list-image": ["none", Ne, Ce] }],
      /**
       * List Style Position
       * @see https://tailwindcss.com/docs/list-style-position
       */
      "list-style-position": [{ list: ["inside", "outside"] }],
      /**
       * List Style Type
       * @see https://tailwindcss.com/docs/list-style-type
       */
      "list-style-type": [
        { list: ["disc", "decimal", "none", Ne, Ce] }
      ],
      /**
       * Text Alignment
       * @see https://tailwindcss.com/docs/text-align
       */
      "text-alignment": [{ text: ["left", "center", "right", "justify", "start", "end"] }],
      /**
       * Placeholder Color
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://v3.tailwindcss.com/docs/placeholder-color
       */
      "placeholder-color": [{ placeholder: I() }],
      /**
       * Text Color
       * @see https://tailwindcss.com/docs/text-color
       */
      "text-color": [{ text: I() }],
      /**
       * Text Decoration
       * @see https://tailwindcss.com/docs/text-decoration
       */
      "text-decoration": ["underline", "overline", "line-through", "no-underline"],
      /**
       * Text Decoration Style
       * @see https://tailwindcss.com/docs/text-decoration-style
       */
      "text-decoration-style": [{ decoration: [...ve(), "wavy"] }],
      /**
       * Text Decoration Thickness
       * @see https://tailwindcss.com/docs/text-decoration-thickness
       */
      "text-decoration-thickness": [
        {
          decoration: [tt, "from-font", "auto", Ne, oo]
        }
      ],
      /**
       * Text Decoration Color
       * @see https://tailwindcss.com/docs/text-decoration-color
       */
      "text-decoration-color": [{ decoration: I() }],
      /**
       * Text Underline Offset
       * @see https://tailwindcss.com/docs/text-underline-offset
       */
      "underline-offset": [
        { "underline-offset": [tt, "auto", Ne, Ce] }
      ],
      /**
       * Text Transform
       * @see https://tailwindcss.com/docs/text-transform
       */
      "text-transform": ["uppercase", "lowercase", "capitalize", "normal-case"],
      /**
       * Text Overflow
       * @see https://tailwindcss.com/docs/text-overflow
       */
      "text-overflow": ["truncate", "text-ellipsis", "text-clip"],
      /**
       * Text Wrap
       * @see https://tailwindcss.com/docs/text-wrap
       */
      "text-wrap": [{ text: ["wrap", "nowrap", "balance", "pretty"] }],
      /**
       * Text Indent
       * @see https://tailwindcss.com/docs/text-indent
       */
      indent: [{ indent: w() }],
      /**
       * Tab Size
       * @see https://tailwindcss.com/docs/tab-size
       */
      "tab-size": [{ tab: [qr, Ne, Ce] }],
      /**
       * Vertical Alignment
       * @see https://tailwindcss.com/docs/vertical-align
       */
      "vertical-align": [
        {
          align: [
            "baseline",
            "top",
            "middle",
            "bottom",
            "text-top",
            "text-bottom",
            "sub",
            "super",
            Ne,
            Ce
          ]
        }
      ],
      /**
       * Whitespace
       * @see https://tailwindcss.com/docs/whitespace
       */
      whitespace: [
        { whitespace: ["normal", "nowrap", "pre", "pre-line", "pre-wrap", "break-spaces"] }
      ],
      /**
       * Word Break
       * @see https://tailwindcss.com/docs/word-break
       */
      break: [{ break: ["normal", "words", "all", "keep"] }],
      /**
       * Overflow Wrap
       * @see https://tailwindcss.com/docs/overflow-wrap
       */
      wrap: [{ wrap: ["break-word", "anywhere", "normal"] }],
      /**
       * Hyphens
       * @see https://tailwindcss.com/docs/hyphens
       */
      hyphens: [{ hyphens: ["none", "manual", "auto"] }],
      /**
       * Content
       * @see https://tailwindcss.com/docs/content
       */
      content: [{ content: ["none", Ne, Ce] }],
      // -------------------
      // --- Backgrounds ---
      // -------------------
      /**
       * Background Attachment
       * @see https://tailwindcss.com/docs/background-attachment
       */
      "bg-attachment": [{ bg: ["fixed", "local", "scroll"] }],
      /**
       * Background Clip
       * @see https://tailwindcss.com/docs/background-clip
       */
      "bg-clip": [{ "bg-clip": ["border", "padding", "content", "text"] }],
      /**
       * Background Origin
       * @see https://tailwindcss.com/docs/background-origin
       */
      "bg-origin": [{ "bg-origin": ["border", "padding", "content"] }],
      /**
       * Background Position
       * @see https://tailwindcss.com/docs/background-position
       */
      "bg-position": [{ bg: te() }],
      /**
       * Background Repeat
       * @see https://tailwindcss.com/docs/background-repeat
       */
      "bg-repeat": [{ bg: F() }],
      /**
       * Background Size
       * @see https://tailwindcss.com/docs/background-size
       */
      "bg-size": [{ bg: Q() }],
      /**
       * Background Image
       * @see https://tailwindcss.com/docs/background-image
       */
      "bg-image": [
        {
          bg: [
            "none",
            {
              linear: [
                { to: ["t", "tr", "r", "br", "b", "bl", "l", "tl"] },
                qr,
                Ne,
                Ce
              ],
              radial: ["", Ne, Ce],
              conic: [qr, Ne, Ce]
            },
            I1,
            O1
          ]
        }
      ],
      /**
       * Background Color
       * @see https://tailwindcss.com/docs/background-color
       */
      "bg-color": [{ bg: I() }],
      /**
       * Gradient Color Stops From Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-from-pos": [{ from: pe() }],
      /**
       * Gradient Color Stops Via Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-via-pos": [{ via: pe() }],
      /**
       * Gradient Color Stops To Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-to-pos": [{ to: pe() }],
      /**
       * Gradient Color Stops From
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-from": [{ from: I() }],
      /**
       * Gradient Color Stops Via
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-via": [{ via: I() }],
      /**
       * Gradient Color Stops To
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-to": [{ to: I() }],
      // ---------------
      // --- Borders ---
      // ---------------
      /**
       * Border Radius
       * @see https://tailwindcss.com/docs/border-radius
       */
      rounded: [{ rounded: fe() }],
      /**
       * Border Radius Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-s": [{ "rounded-s": fe() }],
      /**
       * Border Radius End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-e": [{ "rounded-e": fe() }],
      /**
       * Border Radius Top
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-t": [{ "rounded-t": fe() }],
      /**
       * Border Radius Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-r": [{ "rounded-r": fe() }],
      /**
       * Border Radius Bottom
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-b": [{ "rounded-b": fe() }],
      /**
       * Border Radius Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-l": [{ "rounded-l": fe() }],
      /**
       * Border Radius Start Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-ss": [{ "rounded-ss": fe() }],
      /**
       * Border Radius Start End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-se": [{ "rounded-se": fe() }],
      /**
       * Border Radius End End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-ee": [{ "rounded-ee": fe() }],
      /**
       * Border Radius End Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-es": [{ "rounded-es": fe() }],
      /**
       * Border Radius Top Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-tl": [{ "rounded-tl": fe() }],
      /**
       * Border Radius Top Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-tr": [{ "rounded-tr": fe() }],
      /**
       * Border Radius Bottom Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-br": [{ "rounded-br": fe() }],
      /**
       * Border Radius Bottom Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-bl": [{ "rounded-bl": fe() }],
      /**
       * Border Width
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w": [{ border: G() }],
      /**
       * Border Width Inline
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-x": [{ "border-x": G() }],
      /**
       * Border Width Block
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-y": [{ "border-y": G() }],
      /**
       * Border Width Inline Start
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-s": [{ "border-s": G() }],
      /**
       * Border Width Inline End
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-e": [{ "border-e": G() }],
      /**
       * Border Width Block Start
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-bs": [{ "border-bs": G() }],
      /**
       * Border Width Block End
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-be": [{ "border-be": G() }],
      /**
       * Border Width Top
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-t": [{ "border-t": G() }],
      /**
       * Border Width Right
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-r": [{ "border-r": G() }],
      /**
       * Border Width Bottom
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-b": [{ "border-b": G() }],
      /**
       * Border Width Left
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-l": [{ "border-l": G() }],
      /**
       * Divide Width X
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-x": [{ "divide-x": G() }],
      /**
       * Divide Width X Reverse
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-x-reverse": ["divide-x-reverse"],
      /**
       * Divide Width Y
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-y": [{ "divide-y": G() }],
      /**
       * Divide Width Y Reverse
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-y-reverse": ["divide-y-reverse"],
      /**
       * Border Style
       * @see https://tailwindcss.com/docs/border-style
       */
      "border-style": [{ border: [...ve(), "hidden", "none"] }],
      /**
       * Divide Style
       * @see https://tailwindcss.com/docs/border-style#setting-the-divider-style
       */
      "divide-style": [{ divide: [...ve(), "hidden", "none"] }],
      /**
       * Border Color
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color": [{ border: I() }],
      /**
       * Border Color Inline
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-x": [{ "border-x": I() }],
      /**
       * Border Color Block
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-y": [{ "border-y": I() }],
      /**
       * Border Color Inline Start
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-s": [{ "border-s": I() }],
      /**
       * Border Color Inline End
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-e": [{ "border-e": I() }],
      /**
       * Border Color Block Start
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-bs": [{ "border-bs": I() }],
      /**
       * Border Color Block End
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-be": [{ "border-be": I() }],
      /**
       * Border Color Top
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-t": [{ "border-t": I() }],
      /**
       * Border Color Right
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-r": [{ "border-r": I() }],
      /**
       * Border Color Bottom
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-b": [{ "border-b": I() }],
      /**
       * Border Color Left
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-l": [{ "border-l": I() }],
      /**
       * Divide Color
       * @see https://tailwindcss.com/docs/divide-color
       */
      "divide-color": [{ divide: I() }],
      /**
       * Outline Style
       * @see https://tailwindcss.com/docs/outline-style
       */
      "outline-style": [{ outline: [...ve(), "none", "hidden"] }],
      /**
       * Outline Offset
       * @see https://tailwindcss.com/docs/outline-offset
       */
      "outline-offset": [{ "outline-offset": [tt, Ne, Ce] }],
      /**
       * Outline Width
       * @see https://tailwindcss.com/docs/outline-width
       */
      "outline-w": [{ outline: ["", tt, us, oo] }],
      /**
       * Outline Color
       * @see https://tailwindcss.com/docs/outline-color
       */
      "outline-color": [{ outline: I() }],
      // ---------------
      // --- Effects ---
      // ---------------
      /**
       * Box Shadow
       * @see https://tailwindcss.com/docs/box-shadow
       */
      shadow: [
        {
          shadow: [
            // Deprecated since Tailwind CSS v4.0.0
            "",
            "none",
            d,
            di,
            ui
          ]
        }
      ],
      /**
       * Box Shadow Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-shadow-color
       */
      "shadow-color": [{ shadow: I() }],
      /**
       * Inset Box Shadow
       * @see https://tailwindcss.com/docs/box-shadow#adding-an-inset-shadow
       */
      "inset-shadow": [
        {
          "inset-shadow": ["none", f, di, ui]
        }
      ],
      /**
       * Inset Box Shadow Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-inset-shadow-color
       */
      "inset-shadow-color": [{ "inset-shadow": I() }],
      /**
       * Ring Width
       * @see https://tailwindcss.com/docs/box-shadow#adding-a-ring
       */
      "ring-w": [{ ring: G() }],
      /**
       * Ring Width Inset
       * @see https://v3.tailwindcss.com/docs/ring-width#inset-rings
       * @deprecated since Tailwind CSS v4.0.0
       * @see https://github.com/tailwindlabs/tailwindcss/blob/v4.0.0/packages/tailwindcss/src/utilities.ts#L4158
       */
      "ring-w-inset": ["ring-inset"],
      /**
       * Ring Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-ring-color
       */
      "ring-color": [{ ring: I() }],
      /**
       * Ring Offset Width
       * @see https://v3.tailwindcss.com/docs/ring-offset-width
       * @deprecated since Tailwind CSS v4.0.0
       * @see https://github.com/tailwindlabs/tailwindcss/blob/v4.0.0/packages/tailwindcss/src/utilities.ts#L4158
       */
      "ring-offset-w": [{ "ring-offset": [tt, oo] }],
      /**
       * Ring Offset Color
       * @see https://v3.tailwindcss.com/docs/ring-offset-color
       * @deprecated since Tailwind CSS v4.0.0
       * @see https://github.com/tailwindlabs/tailwindcss/blob/v4.0.0/packages/tailwindcss/src/utilities.ts#L4158
       */
      "ring-offset-color": [{ "ring-offset": I() }],
      /**
       * Inset Ring Width
       * @see https://tailwindcss.com/docs/box-shadow#adding-an-inset-ring
       */
      "inset-ring-w": [{ "inset-ring": G() }],
      /**
       * Inset Ring Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-inset-ring-color
       */
      "inset-ring-color": [{ "inset-ring": I() }],
      /**
       * Text Shadow
       * @see https://tailwindcss.com/docs/text-shadow
       */
      "text-shadow": [
        {
          "text-shadow": ["none", h, di, ui]
        }
      ],
      /**
       * Text Shadow Color
       * @see https://tailwindcss.com/docs/text-shadow#setting-the-shadow-color
       */
      "text-shadow-color": [{ "text-shadow": I() }],
      /**
       * Opacity
       * @see https://tailwindcss.com/docs/opacity
       */
      opacity: [{ opacity: [tt, Ne, Ce] }],
      /**
       * Mix Blend Mode
       * @see https://tailwindcss.com/docs/mix-blend-mode
       */
      "mix-blend": [{ "mix-blend": [...ke(), "plus-darker", "plus-lighter"] }],
      /**
       * Background Blend Mode
       * @see https://tailwindcss.com/docs/background-blend-mode
       */
      "bg-blend": [{ "bg-blend": ke() }],
      /**
       * Mask Clip
       * @see https://tailwindcss.com/docs/mask-clip
       */
      "mask-clip": [
        { "mask-clip": ["border", "padding", "content", "fill", "stroke", "view"] },
        "mask-no-clip"
      ],
      /**
       * Mask Composite
       * @see https://tailwindcss.com/docs/mask-composite
       */
      "mask-composite": [{ mask: ["add", "subtract", "intersect", "exclude"] }],
      /**
       * Mask Image
       * @see https://tailwindcss.com/docs/mask-image
       */
      "mask-image-linear-pos": [{ "mask-linear": [tt] }],
      "mask-image-linear-from-pos": [{ "mask-linear-from": se() }],
      "mask-image-linear-to-pos": [{ "mask-linear-to": se() }],
      "mask-image-linear-from-color": [{ "mask-linear-from": I() }],
      "mask-image-linear-to-color": [{ "mask-linear-to": I() }],
      "mask-image-t-from-pos": [{ "mask-t-from": se() }],
      "mask-image-t-to-pos": [{ "mask-t-to": se() }],
      "mask-image-t-from-color": [{ "mask-t-from": I() }],
      "mask-image-t-to-color": [{ "mask-t-to": I() }],
      "mask-image-r-from-pos": [{ "mask-r-from": se() }],
      "mask-image-r-to-pos": [{ "mask-r-to": se() }],
      "mask-image-r-from-color": [{ "mask-r-from": I() }],
      "mask-image-r-to-color": [{ "mask-r-to": I() }],
      "mask-image-b-from-pos": [{ "mask-b-from": se() }],
      "mask-image-b-to-pos": [{ "mask-b-to": se() }],
      "mask-image-b-from-color": [{ "mask-b-from": I() }],
      "mask-image-b-to-color": [{ "mask-b-to": I() }],
      "mask-image-l-from-pos": [{ "mask-l-from": se() }],
      "mask-image-l-to-pos": [{ "mask-l-to": se() }],
      "mask-image-l-from-color": [{ "mask-l-from": I() }],
      "mask-image-l-to-color": [{ "mask-l-to": I() }],
      "mask-image-x-from-pos": [{ "mask-x-from": se() }],
      "mask-image-x-to-pos": [{ "mask-x-to": se() }],
      "mask-image-x-from-color": [{ "mask-x-from": I() }],
      "mask-image-x-to-color": [{ "mask-x-to": I() }],
      "mask-image-y-from-pos": [{ "mask-y-from": se() }],
      "mask-image-y-to-pos": [{ "mask-y-to": se() }],
      "mask-image-y-from-color": [{ "mask-y-from": I() }],
      "mask-image-y-to-color": [{ "mask-y-to": I() }],
      "mask-image-radial": [{ "mask-radial": [Ne, Ce] }],
      "mask-image-radial-from-pos": [{ "mask-radial-from": se() }],
      "mask-image-radial-to-pos": [{ "mask-radial-to": se() }],
      "mask-image-radial-from-color": [{ "mask-radial-from": I() }],
      "mask-image-radial-to-color": [{ "mask-radial-to": I() }],
      "mask-image-radial-shape": [{ "mask-radial": ["circle", "ellipse"] }],
      "mask-image-radial-size": [
        { "mask-radial": [{ closest: ["side", "corner"], farthest: ["side", "corner"] }] }
      ],
      "mask-image-radial-pos": [{ "mask-radial-at": b() }],
      "mask-image-conic-pos": [{ "mask-conic": [tt] }],
      "mask-image-conic-from-pos": [{ "mask-conic-from": se() }],
      "mask-image-conic-to-pos": [{ "mask-conic-to": se() }],
      "mask-image-conic-from-color": [{ "mask-conic-from": I() }],
      "mask-image-conic-to-color": [{ "mask-conic-to": I() }],
      /**
       * Mask Mode
       * @see https://tailwindcss.com/docs/mask-mode
       */
      "mask-mode": [{ mask: ["alpha", "luminance", "match"] }],
      /**
       * Mask Origin
       * @see https://tailwindcss.com/docs/mask-origin
       */
      "mask-origin": [{ "mask-origin": ["border", "padding", "content", "fill", "stroke", "view"] }],
      /**
       * Mask Position
       * @see https://tailwindcss.com/docs/mask-position
       */
      "mask-position": [{ mask: te() }],
      /**
       * Mask Repeat
       * @see https://tailwindcss.com/docs/mask-repeat
       */
      "mask-repeat": [{ mask: F() }],
      /**
       * Mask Size
       * @see https://tailwindcss.com/docs/mask-size
       */
      "mask-size": [{ mask: Q() }],
      /**
       * Mask Type
       * @see https://tailwindcss.com/docs/mask-type
       */
      "mask-type": [{ "mask-type": ["alpha", "luminance"] }],
      /**
       * Mask Image
       * @see https://tailwindcss.com/docs/mask-image
       */
      "mask-image": [{ mask: ["none", Ne, Ce] }],
      // ---------------
      // --- Filters ---
      // ---------------
      /**
       * Filter
       * @see https://tailwindcss.com/docs/filter
       */
      filter: [
        {
          filter: [
            // Deprecated since Tailwind CSS v3.0.0
            "",
            "none",
            Ne,
            Ce
          ]
        }
      ],
      /**
       * Blur
       * @see https://tailwindcss.com/docs/blur
       */
      blur: [{ blur: ye() }],
      /**
       * Brightness
       * @see https://tailwindcss.com/docs/brightness
       */
      brightness: [{ brightness: [tt, Ne, Ce] }],
      /**
       * Contrast
       * @see https://tailwindcss.com/docs/contrast
       */
      contrast: [{ contrast: [tt, Ne, Ce] }],
      /**
       * Drop Shadow
       * @see https://tailwindcss.com/docs/drop-shadow
       */
      "drop-shadow": [
        {
          "drop-shadow": [
            // Deprecated since Tailwind CSS v4.0.0
            "",
            "none",
            p,
            di,
            ui
          ]
        }
      ],
      /**
       * Drop Shadow Color
       * @see https://tailwindcss.com/docs/filter-drop-shadow#setting-the-shadow-color
       */
      "drop-shadow-color": [{ "drop-shadow": I() }],
      /**
       * Grayscale
       * @see https://tailwindcss.com/docs/grayscale
       */
      grayscale: [{ grayscale: ["", tt, Ne, Ce] }],
      /**
       * Hue Rotate
       * @see https://tailwindcss.com/docs/hue-rotate
       */
      "hue-rotate": [{ "hue-rotate": [tt, Ne, Ce] }],
      /**
       * Invert
       * @see https://tailwindcss.com/docs/invert
       */
      invert: [{ invert: ["", tt, Ne, Ce] }],
      /**
       * Saturate
       * @see https://tailwindcss.com/docs/saturate
       */
      saturate: [{ saturate: [tt, Ne, Ce] }],
      /**
       * Sepia
       * @see https://tailwindcss.com/docs/sepia
       */
      sepia: [{ sepia: ["", tt, Ne, Ce] }],
      /**
       * Backdrop Filter
       * @see https://tailwindcss.com/docs/backdrop-filter
       */
      "backdrop-filter": [
        {
          "backdrop-filter": [
            // Deprecated since Tailwind CSS v3.0.0
            "",
            "none",
            Ne,
            Ce
          ]
        }
      ],
      /**
       * Backdrop Blur
       * @see https://tailwindcss.com/docs/backdrop-blur
       */
      "backdrop-blur": [{ "backdrop-blur": ye() }],
      /**
       * Backdrop Brightness
       * @see https://tailwindcss.com/docs/backdrop-brightness
       */
      "backdrop-brightness": [
        { "backdrop-brightness": [tt, Ne, Ce] }
      ],
      /**
       * Backdrop Contrast
       * @see https://tailwindcss.com/docs/backdrop-contrast
       */
      "backdrop-contrast": [
        { "backdrop-contrast": [tt, Ne, Ce] }
      ],
      /**
       * Backdrop Grayscale
       * @see https://tailwindcss.com/docs/backdrop-grayscale
       */
      "backdrop-grayscale": [
        { "backdrop-grayscale": ["", tt, Ne, Ce] }
      ],
      /**
       * Backdrop Hue Rotate
       * @see https://tailwindcss.com/docs/backdrop-hue-rotate
       */
      "backdrop-hue-rotate": [
        { "backdrop-hue-rotate": [tt, Ne, Ce] }
      ],
      /**
       * Backdrop Invert
       * @see https://tailwindcss.com/docs/backdrop-invert
       */
      "backdrop-invert": [
        { "backdrop-invert": ["", tt, Ne, Ce] }
      ],
      /**
       * Backdrop Opacity
       * @see https://tailwindcss.com/docs/backdrop-opacity
       */
      "backdrop-opacity": [{ "backdrop-opacity": [tt, Ne, Ce] }],
      /**
       * Backdrop Saturate
       * @see https://tailwindcss.com/docs/backdrop-saturate
       */
      "backdrop-saturate": [
        { "backdrop-saturate": [tt, Ne, Ce] }
      ],
      /**
       * Backdrop Sepia
       * @see https://tailwindcss.com/docs/backdrop-sepia
       */
      "backdrop-sepia": [{ "backdrop-sepia": ["", tt, Ne, Ce] }],
      // --------------
      // --- Tables ---
      // --------------
      /**
       * Border Collapse
       * @see https://tailwindcss.com/docs/border-collapse
       */
      "border-collapse": [{ border: ["collapse", "separate"] }],
      /**
       * Border Spacing
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing": [{ "border-spacing": w() }],
      /**
       * Border Spacing X
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing-x": [{ "border-spacing-x": w() }],
      /**
       * Border Spacing Y
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing-y": [{ "border-spacing-y": w() }],
      /**
       * Table Layout
       * @see https://tailwindcss.com/docs/table-layout
       */
      "table-layout": [{ table: ["auto", "fixed"] }],
      /**
       * Caption Side
       * @see https://tailwindcss.com/docs/caption-side
       */
      caption: [{ caption: ["top", "bottom"] }],
      // ---------------------------------
      // --- Transitions and Animation ---
      // ---------------------------------
      /**
       * Transition Property
       * @see https://tailwindcss.com/docs/transition-property
       */
      transition: [
        {
          transition: [
            "",
            "all",
            "colors",
            "opacity",
            "shadow",
            "transform",
            "none",
            Ne,
            Ce
          ]
        }
      ],
      /**
       * Transition Behavior
       * @see https://tailwindcss.com/docs/transition-behavior
       */
      "transition-behavior": [{ transition: ["normal", "discrete"] }],
      /**
       * Transition Duration
       * @see https://tailwindcss.com/docs/transition-duration
       */
      duration: [{ duration: [tt, "initial", Ne, Ce] }],
      /**
       * Transition Timing Function
       * @see https://tailwindcss.com/docs/transition-timing-function
       */
      ease: [{ ease: ["linear", "initial", _, Ne, Ce] }],
      /**
       * Transition Delay
       * @see https://tailwindcss.com/docs/transition-delay
       */
      delay: [{ delay: [tt, Ne, Ce] }],
      /**
       * Animation
       * @see https://tailwindcss.com/docs/animation
       */
      animate: [{ animate: ["none", k, Ne, Ce] }],
      // ------------------
      // --- Transforms ---
      // ------------------
      /**
       * Backface Visibility
       * @see https://tailwindcss.com/docs/backface-visibility
       */
      backface: [{ backface: ["hidden", "visible"] }],
      /**
       * Perspective
       * @see https://tailwindcss.com/docs/perspective
       */
      perspective: [{ perspective: [g, Ne, Ce] }],
      /**
       * Perspective Origin
       * @see https://tailwindcss.com/docs/perspective-origin
       */
      "perspective-origin": [{ "perspective-origin": $() }],
      /**
       * Rotate
       * @see https://tailwindcss.com/docs/rotate
       */
      rotate: [{ rotate: U() }],
      /**
       * Rotate X
       * @see https://tailwindcss.com/docs/rotate
       */
      "rotate-x": [{ "rotate-x": U() }],
      /**
       * Rotate Y
       * @see https://tailwindcss.com/docs/rotate
       */
      "rotate-y": [{ "rotate-y": U() }],
      /**
       * Rotate Z
       * @see https://tailwindcss.com/docs/rotate
       */
      "rotate-z": [{ "rotate-z": U() }],
      /**
       * Scale
       * @see https://tailwindcss.com/docs/scale
       */
      scale: [{ scale: ee() }],
      /**
       * Scale X
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-x": [{ "scale-x": ee() }],
      /**
       * Scale Y
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-y": [{ "scale-y": ee() }],
      /**
       * Scale Z
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-z": [{ "scale-z": ee() }],
      /**
       * Scale 3D
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-3d": ["scale-3d"],
      /**
       * Skew
       * @see https://tailwindcss.com/docs/skew
       */
      skew: [{ skew: ue() }],
      /**
       * Skew X
       * @see https://tailwindcss.com/docs/skew
       */
      "skew-x": [{ "skew-x": ue() }],
      /**
       * Skew Y
       * @see https://tailwindcss.com/docs/skew
       */
      "skew-y": [{ "skew-y": ue() }],
      /**
       * Transform
       * @see https://tailwindcss.com/docs/transform
       */
      transform: [{ transform: [Ne, Ce, "", "none", "gpu", "cpu"] }],
      /**
       * Transform Origin
       * @see https://tailwindcss.com/docs/transform-origin
       */
      "transform-origin": [{ origin: $() }],
      /**
       * Transform Style
       * @see https://tailwindcss.com/docs/transform-style
       */
      "transform-style": [{ transform: ["3d", "flat"] }],
      /**
       * Translate
       * @see https://tailwindcss.com/docs/translate
       */
      translate: [{ translate: me() }],
      /**
       * Translate X
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-x": [{ "translate-x": me() }],
      /**
       * Translate Y
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-y": [{ "translate-y": me() }],
      /**
       * Translate Z
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-z": [{ "translate-z": me() }],
      /**
       * Translate None
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-none": ["translate-none"],
      /**
       * Zoom
       * @see https://tailwindcss.com/docs/zoom
       */
      zoom: [{ zoom: [qr, Ne, Ce] }],
      // ---------------------
      // --- Interactivity ---
      // ---------------------
      /**
       * Accent Color
       * @see https://tailwindcss.com/docs/accent-color
       */
      accent: [{ accent: I() }],
      /**
       * Appearance
       * @see https://tailwindcss.com/docs/appearance
       */
      appearance: [{ appearance: ["none", "auto"] }],
      /**
       * Caret Color
       * @see https://tailwindcss.com/docs/just-in-time-mode#caret-color-utilities
       */
      "caret-color": [{ caret: I() }],
      /**
       * Color Scheme
       * @see https://tailwindcss.com/docs/color-scheme
       */
      "color-scheme": [
        { scheme: ["normal", "dark", "light", "light-dark", "only-dark", "only-light"] }
      ],
      /**
       * Cursor
       * @see https://tailwindcss.com/docs/cursor
       */
      cursor: [
        {
          cursor: [
            "auto",
            "default",
            "pointer",
            "wait",
            "text",
            "move",
            "help",
            "not-allowed",
            "none",
            "context-menu",
            "progress",
            "cell",
            "crosshair",
            "vertical-text",
            "alias",
            "copy",
            "no-drop",
            "grab",
            "grabbing",
            "all-scroll",
            "col-resize",
            "row-resize",
            "n-resize",
            "e-resize",
            "s-resize",
            "w-resize",
            "ne-resize",
            "nw-resize",
            "se-resize",
            "sw-resize",
            "ew-resize",
            "ns-resize",
            "nesw-resize",
            "nwse-resize",
            "zoom-in",
            "zoom-out",
            Ne,
            Ce
          ]
        }
      ],
      /**
       * Field Sizing
       * @see https://tailwindcss.com/docs/field-sizing
       */
      "field-sizing": [{ "field-sizing": ["fixed", "content"] }],
      /**
       * Pointer Events
       * @see https://tailwindcss.com/docs/pointer-events
       */
      "pointer-events": [{ "pointer-events": ["auto", "none"] }],
      /**
       * Resize
       * @see https://tailwindcss.com/docs/resize
       */
      resize: [{ resize: ["none", "", "y", "x"] }],
      /**
       * Scroll Behavior
       * @see https://tailwindcss.com/docs/scroll-behavior
       */
      "scroll-behavior": [{ scroll: ["auto", "smooth"] }],
      /**
       * Scrollbar Thumb Color
       * @see https://tailwindcss.com/docs/scrollbar-color
       */
      "scrollbar-thumb-color": [{ "scrollbar-thumb": I() }],
      /**
       * Scrollbar Track Color
       * @see https://tailwindcss.com/docs/scrollbar-color
       */
      "scrollbar-track-color": [{ "scrollbar-track": I() }],
      /**
       * Scrollbar Gutter
       * @see https://tailwindcss.com/docs/scrollbar-gutter
       */
      "scrollbar-gutter": [{ "scrollbar-gutter": ["auto", "stable", "both"] }],
      /**
       * Scrollbar Width
       * @see https://tailwindcss.com/docs/scrollbar-width
       */
      "scrollbar-w": [{ scrollbar: ["auto", "thin", "none"] }],
      /**
       * Scroll Margin
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-m": [{ "scroll-m": w() }],
      /**
       * Scroll Margin Inline
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mx": [{ "scroll-mx": w() }],
      /**
       * Scroll Margin Block
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-my": [{ "scroll-my": w() }],
      /**
       * Scroll Margin Inline Start
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-ms": [{ "scroll-ms": w() }],
      /**
       * Scroll Margin Inline End
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-me": [{ "scroll-me": w() }],
      /**
       * Scroll Margin Block Start
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mbs": [{ "scroll-mbs": w() }],
      /**
       * Scroll Margin Block End
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mbe": [{ "scroll-mbe": w() }],
      /**
       * Scroll Margin Top
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mt": [{ "scroll-mt": w() }],
      /**
       * Scroll Margin Right
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mr": [{ "scroll-mr": w() }],
      /**
       * Scroll Margin Bottom
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mb": [{ "scroll-mb": w() }],
      /**
       * Scroll Margin Left
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-ml": [{ "scroll-ml": w() }],
      /**
       * Scroll Padding
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-p": [{ "scroll-p": w() }],
      /**
       * Scroll Padding Inline
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-px": [{ "scroll-px": w() }],
      /**
       * Scroll Padding Block
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-py": [{ "scroll-py": w() }],
      /**
       * Scroll Padding Inline Start
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-ps": [{ "scroll-ps": w() }],
      /**
       * Scroll Padding Inline End
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pe": [{ "scroll-pe": w() }],
      /**
       * Scroll Padding Block Start
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pbs": [{ "scroll-pbs": w() }],
      /**
       * Scroll Padding Block End
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pbe": [{ "scroll-pbe": w() }],
      /**
       * Scroll Padding Top
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pt": [{ "scroll-pt": w() }],
      /**
       * Scroll Padding Right
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pr": [{ "scroll-pr": w() }],
      /**
       * Scroll Padding Bottom
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pb": [{ "scroll-pb": w() }],
      /**
       * Scroll Padding Left
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pl": [{ "scroll-pl": w() }],
      /**
       * Scroll Snap Align
       * @see https://tailwindcss.com/docs/scroll-snap-align
       */
      "snap-align": [{ snap: ["start", "end", "center", "align-none"] }],
      /**
       * Scroll Snap Stop
       * @see https://tailwindcss.com/docs/scroll-snap-stop
       */
      "snap-stop": [{ snap: ["normal", "always"] }],
      /**
       * Scroll Snap Type
       * @see https://tailwindcss.com/docs/scroll-snap-type
       */
      "snap-type": [{ snap: ["none", "x", "y", "both"] }],
      /**
       * Scroll Snap Type Strictness
       * @see https://tailwindcss.com/docs/scroll-snap-type
       */
      "snap-strictness": [{ snap: ["mandatory", "proximity"] }],
      /**
       * Touch Action
       * @see https://tailwindcss.com/docs/touch-action
       */
      touch: [{ touch: ["auto", "none", "manipulation"] }],
      /**
       * Touch Action X
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-x": [{ "touch-pan": ["x", "left", "right"] }],
      /**
       * Touch Action Y
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-y": [{ "touch-pan": ["y", "up", "down"] }],
      /**
       * Touch Action Pinch Zoom
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-pz": ["touch-pinch-zoom"],
      /**
       * User Select
       * @see https://tailwindcss.com/docs/user-select
       */
      select: [{ select: ["none", "text", "all", "auto"] }],
      /**
       * Will Change
       * @see https://tailwindcss.com/docs/will-change
       */
      "will-change": [
        {
          "will-change": [
            "auto",
            "scroll",
            "contents",
            "transform",
            Ne,
            Ce
          ]
        }
      ],
      // -----------
      // --- SVG ---
      // -----------
      /**
       * Fill
       * @see https://tailwindcss.com/docs/fill
       */
      fill: [{ fill: ["none", ...I()] }],
      /**
       * Stroke Width
       * @see https://tailwindcss.com/docs/stroke-width
       */
      "stroke-w": [
        {
          stroke: [tt, us, oo, pd]
        }
      ],
      /**
       * Stroke
       * @see https://tailwindcss.com/docs/stroke
       */
      stroke: [{ stroke: ["none", ...I()] }],
      // ---------------------
      // --- Accessibility ---
      // ---------------------
      /**
       * Forced Color Adjust
       * @see https://tailwindcss.com/docs/forced-color-adjust
       */
      "forced-color-adjust": [{ "forced-color-adjust": ["auto", "none"] }]
    },
    conflictingClassGroups: {
      "container-named": ["container-type"],
      overflow: ["overflow-x", "overflow-y"],
      overscroll: ["overscroll-x", "overscroll-y"],
      inset: [
        "inset-x",
        "inset-y",
        "inset-bs",
        "inset-be",
        "start",
        "end",
        "top",
        "right",
        "bottom",
        "left"
      ],
      "inset-x": ["right", "left"],
      "inset-y": ["top", "bottom"],
      flex: ["basis", "grow", "shrink"],
      gap: ["gap-x", "gap-y"],
      p: ["px", "py", "ps", "pe", "pbs", "pbe", "pt", "pr", "pb", "pl"],
      px: ["pr", "pl"],
      py: ["pt", "pb"],
      m: ["mx", "my", "ms", "me", "mbs", "mbe", "mt", "mr", "mb", "ml"],
      mx: ["mr", "ml"],
      my: ["mt", "mb"],
      size: ["w", "h"],
      "font-size": ["leading"],
      "fvn-normal": [
        "fvn-ordinal",
        "fvn-slashed-zero",
        "fvn-figure",
        "fvn-spacing",
        "fvn-fraction"
      ],
      "fvn-ordinal": ["fvn-normal"],
      "fvn-slashed-zero": ["fvn-normal"],
      "fvn-figure": ["fvn-normal"],
      "fvn-spacing": ["fvn-normal"],
      "fvn-fraction": ["fvn-normal"],
      "line-clamp": ["display", "overflow"],
      rounded: [
        "rounded-s",
        "rounded-e",
        "rounded-t",
        "rounded-r",
        "rounded-b",
        "rounded-l",
        "rounded-ss",
        "rounded-se",
        "rounded-ee",
        "rounded-es",
        "rounded-tl",
        "rounded-tr",
        "rounded-br",
        "rounded-bl"
      ],
      "rounded-s": ["rounded-ss", "rounded-es"],
      "rounded-e": ["rounded-se", "rounded-ee"],
      "rounded-t": ["rounded-tl", "rounded-tr"],
      "rounded-r": ["rounded-tr", "rounded-br"],
      "rounded-b": ["rounded-br", "rounded-bl"],
      "rounded-l": ["rounded-tl", "rounded-bl"],
      "border-spacing": ["border-spacing-x", "border-spacing-y"],
      "border-w": [
        "border-w-x",
        "border-w-y",
        "border-w-s",
        "border-w-e",
        "border-w-bs",
        "border-w-be",
        "border-w-t",
        "border-w-r",
        "border-w-b",
        "border-w-l"
      ],
      "border-w-x": ["border-w-r", "border-w-l"],
      "border-w-y": ["border-w-t", "border-w-b"],
      "border-color": [
        "border-color-x",
        "border-color-y",
        "border-color-s",
        "border-color-e",
        "border-color-bs",
        "border-color-be",
        "border-color-t",
        "border-color-r",
        "border-color-b",
        "border-color-l"
      ],
      "border-color-x": ["border-color-r", "border-color-l"],
      "border-color-y": ["border-color-t", "border-color-b"],
      translate: ["translate-x", "translate-y", "translate-none"],
      "translate-none": ["translate", "translate-x", "translate-y", "translate-z"],
      "scroll-m": [
        "scroll-mx",
        "scroll-my",
        "scroll-ms",
        "scroll-me",
        "scroll-mbs",
        "scroll-mbe",
        "scroll-mt",
        "scroll-mr",
        "scroll-mb",
        "scroll-ml"
      ],
      "scroll-mx": ["scroll-mr", "scroll-ml"],
      "scroll-my": ["scroll-mt", "scroll-mb"],
      "scroll-p": [
        "scroll-px",
        "scroll-py",
        "scroll-ps",
        "scroll-pe",
        "scroll-pbs",
        "scroll-pbe",
        "scroll-pt",
        "scroll-pr",
        "scroll-pb",
        "scroll-pl"
      ],
      "scroll-px": ["scroll-pr", "scroll-pl"],
      "scroll-py": ["scroll-pt", "scroll-pb"],
      touch: ["touch-x", "touch-y", "touch-pz"],
      "touch-x": ["touch"],
      "touch-y": ["touch"],
      "touch-pz": ["touch"]
    },
    conflictingClassGroupModifiers: {
      "font-size": ["leading"]
    },
    postfixLookupClassGroups: ["container-type"],
    orderSensitiveModifiers: [
      "*",
      "**",
      "after",
      "backdrop",
      "before",
      "details-content",
      "file",
      "first-letter",
      "first-line",
      "marker",
      "placeholder",
      "selection"
    ]
  };
}, L1 = (e, { extend: t = {}, override: r = {} }) => (fi(e.theme, r.theme), fi(e.classGroups, r.classGroups), fi(e.conflictingClassGroups, r.conflictingClassGroups), fi(
  e.conflictingClassGroupModifiers,
  r.conflictingClassGroupModifiers
), Nl(e, "postfixLookupClassGroups", r.postfixLookupClassGroups), Nl(e, "orderSensitiveModifiers", r.orderSensitiveModifiers), hi(e.theme, t.theme), hi(e.classGroups, t.classGroups), hi(e.conflictingClassGroups, t.conflictingClassGroups), hi(
  e.conflictingClassGroupModifiers,
  t.conflictingClassGroupModifiers
), Pl(e, t, "postfixLookupClassGroups"), Pl(e, t, "orderSensitiveModifiers"), e), Nl = (e, t, r) => {
  r !== void 0 && (e[t] = r);
}, fi = (e, t) => {
  if (t)
    for (const r in t)
      Nl(e, r, t[r]);
}, hi = (e, t) => {
  if (t)
    for (const r in t)
      Pl(e, t, r);
}, Pl = (e, t, r) => {
  const n = t[r];
  n !== void 0 && (e[r] = e[r] ? e[r].concat(n) : n);
}, Op = (e) => hd(e ? typeof e == "function" ? () => e(Ja()) : () => L1(Ja(), e) : Ja), j1 = (e) => {
  if (_r(e)) return;
  const t = e, r = {
    ...t.extend ?? {}
  };
  for (const o of [
    "theme",
    "classGroups",
    "conflictingClassGroups",
    "conflictingClassGroupModifiers",
    "postfixLookupClassGroups",
    "orderSensitiveModifiers",
    "cacheSize",
    "prefix",
    "separator",
    "experimentalParseClassName"
  ])
    t[o] !== void 0 && r[o] === void 0 && (r[o] = t[o]);
  const n = {};
  if (Object.keys(r).length > 0 && (n.extend = r), t.override != null && !_r(t.override) && (n.override = t.override), !(!n.extend && !n.override))
    return n;
}, V1 = (e) => {
  const t = j1(e), r = Op(t);
  return (n) => r.mergeString(n);
}, Ri, F1 = () => (Ri || (Ri = Op()), Ri), Z1 = () => ((!Ht.cachedTwMerge || Ht.didTwMergeConfigChange) && (Ht.didTwMergeConfigChange = !1, Ht.cachedTwMerge = V1(Ht.cachedTwMergeConfig)), Ht.cachedTwMerge), U1 = (e) => {
  const t = e?.twMergeConfig;
  !t || _r(t) || lp(t, Ht.cachedTwMergeConfig) || (Ht.cachedTwMergeConfig = t, Ht.didTwMergeConfigChange = !0);
}, B1 = (e) => _a(e), W1 = Ht.reset.bind(Ht);
Ht.reset = () => {
  Ri = void 0, W1();
};
var H1 = (e, t) => {
  const r = B1(e);
  return !r || !(t?.twMerge ?? !0) ? r || void 0 : r.indexOf(" ") === -1 ? r : (U1(t), (!!(t?.twMergeConfig && !_r(t.twMergeConfig)) ? Z1() : F1().mergeString)(r) || void 0);
}, q1 = (e, ...t) => H1(t, e), G1 = Z0(q1), Lc = G1.tv;
const K1 = (e, t) => {
  const r = new Array(e.length + t.length);
  for (let n = 0; n < e.length; n++)
    r[n] = e[n];
  for (let n = 0; n < t.length; n++)
    r[e.length + n] = t[n];
  return r;
}, Y1 = (e, t) => ({
  classGroupId: e,
  validator: t
}), Np = (e = /* @__PURE__ */ new Map(), t = null, r) => ({
  nextPart: e,
  validators: t,
  classGroupId: r
}), Qi = "-", md = [], X1 = "arbitrary..", J1 = (e) => {
  const t = ex(e), {
    conflictingClassGroups: r,
    conflictingClassGroupModifiers: n
  } = e;
  return {
    getClassGroupId: (i) => {
      if (i.startsWith("[") && i.endsWith("]"))
        return Q1(i);
      const l = i.split(Qi), c = l[0] === "" && l.length > 1 ? 1 : 0;
      return Pp(l, c, t);
    },
    getConflictingClassGroupIds: (i, l) => {
      if (l) {
        const c = n[i], u = r[i];
        return c ? u ? K1(u, c) : c : u || md;
      }
      return r[i] || md;
    }
  };
}, Pp = (e, t, r) => {
  if (e.length - t === 0)
    return r.classGroupId;
  const o = e[t], s = r.nextPart.get(o);
  if (s) {
    const u = Pp(e, t + 1, s);
    if (u) return u;
  }
  const i = r.validators;
  if (i === null)
    return;
  const l = t === 0 ? e.join(Qi) : e.slice(t).join(Qi), c = i.length;
  for (let u = 0; u < c; u++) {
    const d = i[u];
    if (d.validator(l))
      return d.classGroupId;
  }
}, Q1 = (e) => e.slice(1, -1).indexOf(":") === -1 ? void 0 : (() => {
  const t = e.slice(1, -1), r = t.indexOf(":"), n = t.slice(0, r);
  return n ? X1 + n : void 0;
})(), ex = (e) => {
  const {
    theme: t,
    classGroups: r
  } = e;
  return tx(r, t);
}, tx = (e, t) => {
  const r = Np();
  for (const n in e) {
    const o = e[n];
    jc(o, r, n, t);
  }
  return r;
}, jc = (e, t, r, n) => {
  const o = e.length;
  for (let s = 0; s < o; s++) {
    const i = e[s];
    rx(i, t, r, n);
  }
}, rx = (e, t, r, n) => {
  if (typeof e == "string") {
    nx(e, t, r);
    return;
  }
  if (typeof e == "function") {
    ox(e, t, r, n);
    return;
  }
  sx(e, t, r, n);
}, nx = (e, t, r) => {
  const n = e === "" ? t : Ip(t, e);
  n.classGroupId = r;
}, ox = (e, t, r, n) => {
  if (ix(e)) {
    jc(e(n), t, r, n);
    return;
  }
  t.validators === null && (t.validators = []), t.validators.push(Y1(r, e));
}, sx = (e, t, r, n) => {
  const o = Object.entries(e), s = o.length;
  for (let i = 0; i < s; i++) {
    const [l, c] = o[i];
    jc(c, Ip(t, l), r, n);
  }
}, Ip = (e, t) => {
  let r = e;
  const n = t.split(Qi), o = n.length;
  for (let s = 0; s < o; s++) {
    const i = n[s];
    let l = r.nextPart.get(i);
    l || (l = Np(), r.nextPart.set(i, l)), r = l;
  }
  return r;
}, ix = (e) => "isThemeGetter" in e && e.isThemeGetter === !0, ax = (e) => {
  if (e < 1)
    return {
      get: () => {
      },
      set: () => {
      }
    };
  let t = 0, r = /* @__PURE__ */ Object.create(null), n = /* @__PURE__ */ Object.create(null);
  const o = (s, i) => {
    r[s] = i, t++, t > e && (t = 0, n = r, r = /* @__PURE__ */ Object.create(null));
  };
  return {
    get(s) {
      let i = r[s];
      if (i !== void 0)
        return i;
      if ((i = n[s]) !== void 0)
        return o(s, i), i;
    },
    set(s, i) {
      s in r ? r[s] = i : o(s, i);
    }
  };
}, Il = "!", bd = ":", lx = [], xd = (e, t, r, n, o) => ({
  modifiers: e,
  hasImportantModifier: t,
  baseClassName: r,
  maybePostfixModifierPosition: n,
  isExternal: o
}), cx = (e) => {
  const {
    prefix: t,
    experimentalParseClassName: r
  } = e;
  let n = (o) => {
    const s = [];
    let i = 0, l = 0, c = 0, u;
    const d = o.length;
    for (let g = 0; g < d; g++) {
      const y = o[g];
      if (i === 0 && l === 0) {
        if (y === bd) {
          s.push(o.slice(c, g)), c = g + 1;
          continue;
        }
        if (y === "/") {
          u = g;
          continue;
        }
      }
      y === "[" ? i++ : y === "]" ? i-- : y === "(" ? l++ : y === ")" && l--;
    }
    const f = s.length === 0 ? o : o.slice(c);
    let h = f, p = !1;
    f.endsWith(Il) ? (h = f.slice(0, -1), p = !0) : (
      /**
       * In Tailwind CSS v3 the important modifier was at the start of the base class name. This is still supported for legacy reasons.
       * @see https://github.com/dcastil/tailwind-merge/issues/513#issuecomment-2614029864
       */
      f.startsWith(Il) && (h = f.slice(1), p = !0)
    );
    const v = u && u > c ? u - c : void 0;
    return xd(s, p, h, v);
  };
  if (t) {
    const o = t + bd, s = n;
    n = (i) => i.startsWith(o) ? s(i.slice(o.length)) : xd(lx, !1, i, void 0, !0);
  }
  if (r) {
    const o = n;
    n = (s) => r({
      className: s,
      parseClassName: o
    });
  }
  return n;
}, ux = (e) => {
  const t = /* @__PURE__ */ new Map();
  return e.orderSensitiveModifiers.forEach((r, n) => {
    t.set(r, 1e6 + n);
  }), (r) => {
    const n = [];
    let o = [];
    for (let s = 0; s < r.length; s++) {
      const i = r[s], l = i[0] === "[", c = t.has(i);
      l || c ? (o.length > 0 && (o.sort(), n.push(...o), o = []), n.push(i)) : o.push(i);
    }
    return o.length > 0 && (o.sort(), n.push(...o)), n;
  };
}, dx = (e) => ({
  cache: ax(e.cacheSize),
  parseClassName: cx(e),
  sortModifiers: ux(e),
  postfixLookupClassGroupIds: fx(e),
  ...J1(e)
}), fx = (e) => {
  const t = /* @__PURE__ */ Object.create(null), r = e.postfixLookupClassGroups;
  if (r)
    for (let n = 0; n < r.length; n++)
      t[r[n]] = !0;
  return t;
}, hx = /\s+/, px = (e, t) => {
  const {
    parseClassName: r,
    getClassGroupId: n,
    getConflictingClassGroupIds: o,
    sortModifiers: s,
    postfixLookupClassGroupIds: i
  } = t, l = [], c = e.trim().split(hx);
  let u = "";
  for (let d = c.length - 1; d >= 0; d -= 1) {
    const f = c[d], {
      isExternal: h,
      modifiers: p,
      hasImportantModifier: v,
      baseClassName: g,
      maybePostfixModifierPosition: y
    } = r(f);
    if (h) {
      u = f + (u.length > 0 ? " " + u : u);
      continue;
    }
    let _ = !!y, k;
    if (_) {
      const C = g.substring(0, y);
      k = n(C);
      const w = k && i[k] ? n(g) : void 0;
      w && w !== k && (k = w, _ = !1);
    } else
      k = n(g);
    if (!k) {
      if (!_) {
        u = f + (u.length > 0 ? " " + u : u);
        continue;
      }
      if (k = n(g), !k) {
        u = f + (u.length > 0 ? " " + u : u);
        continue;
      }
      _ = !1;
    }
    const S = p.length === 0 ? "" : p.length === 1 ? p[0] : s(p).join(":"), b = v ? S + Il : S, $ = b + k;
    if (l.indexOf($) > -1)
      continue;
    l.push($);
    const E = o(k, _);
    for (let C = 0; C < E.length; ++C) {
      const w = E[C];
      l.push(b + w);
    }
    u = f + (u.length > 0 ? " " + u : u);
  }
  return u;
}, vx = (...e) => {
  let t = 0, r, n, o = "";
  for (; t < e.length; )
    (r = e[t++]) && (n = Rp(r)) && (o && (o += " "), o += n);
  return o;
}, Rp = (e) => {
  if (typeof e == "string")
    return e;
  let t, r = "";
  for (let n = 0; n < e.length; n++)
    e[n] && (t = Rp(e[n])) && (r && (r += " "), r += t);
  return r;
}, gx = (e, ...t) => {
  let r, n, o, s;
  const i = (c) => {
    const u = t.reduce((d, f) => f(d), e());
    return r = dx(u), n = r.cache.get, o = r.cache.set, s = l, l(c);
  }, l = (c) => {
    const u = n(c);
    if (u)
      return u;
    const d = px(c, r);
    return o(c, d), d;
  };
  return s = i, (...c) => s(vx(...c));
}, mx = [], Pt = (e) => {
  const t = (r) => r[e] || mx;
  return t.isThemeGetter = !0, t.themeKey = e, t;
}, Dp = /^\[(?:(\w[\w-]*):)?(.+)\]$/i, Lp = /^\((?:(\w[\w-]*):)?(.+)\)$/i, bx = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/, xx = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/, yx = /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/, _x = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix|color|light-dark)\(.+\)$/, wx = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/, kx = /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/, In = (e) => bx.test(e), rt = (e) => !!e && !Number.isNaN(Number(e)), Gr = (e) => !!e && Number.isInteger(Number(e)), Qa = (e) => e.endsWith("%") && rt(e.slice(0, -1)), un = (e) => xx.test(e), jp = () => !0, Sx = (e) => (
  // `colorFunctionRegex` check is necessary because color functions can have percentages in them which which would be incorrectly classified as lengths.
  // For example, `hsl(0 0% 0%)` would be classified as a length without this check.
  // I could also use lookbehind assertion in `lengthUnitRegex` but that isn't supported widely enough.
  yx.test(e) && !_x.test(e)
), Vc = () => !1, $x = (e) => wx.test(e), zx = (e) => kx.test(e), Ax = (e) => !Oe(e) && !Pe(e), Ex = (e) => e.startsWith("@container") && (e[10] === "/" && e[11] !== void 0 || e[11] === "s" && e[16] !== void 0 && e.startsWith("-size/", 10) || e[11] === "n" && e[18] !== void 0 && e.startsWith("-normal/", 10)), Mx = (e) => Jn(e, Zp, Vc), Oe = (e) => Dp.test(e), so = (e) => Jn(e, Up, Sx), yd = (e) => Jn(e, Dx, rt), Tx = (e) => Jn(e, Wp, jp), Cx = (e) => Jn(e, Bp, Vc), _d = (e) => Jn(e, Vp, Vc), Ox = (e) => Jn(e, Fp, zx), pi = (e) => Jn(e, Hp, $x), Pe = (e) => Lp.test(e), ds = (e) => $o(e, Up), Nx = (e) => $o(e, Bp), wd = (e) => $o(e, Vp), Px = (e) => $o(e, Zp), Ix = (e) => $o(e, Fp), vi = (e) => $o(e, Hp, !0), Rx = (e) => $o(e, Wp, !0), Jn = (e, t, r) => {
  const n = Dp.exec(e);
  return n ? n[1] ? t(n[1]) : r(n[2]) : !1;
}, $o = (e, t, r = !1) => {
  const n = Lp.exec(e);
  return n ? n[1] ? t(n[1]) : r : !1;
}, Vp = (e) => e === "position" || e === "percentage", Fp = (e) => e === "image" || e === "url", Zp = (e) => e === "length" || e === "size" || e === "bg-size", Up = (e) => e === "length", Dx = (e) => e === "number", Bp = (e) => e === "family-name", Wp = (e) => e === "number" || e === "weight", Hp = (e) => e === "shadow", Lx = () => {
  const e = Pt("color"), t = Pt("font"), r = Pt("text"), n = Pt("font-weight"), o = Pt("tracking"), s = Pt("leading"), i = Pt("breakpoint"), l = Pt("container"), c = Pt("spacing"), u = Pt("radius"), d = Pt("shadow"), f = Pt("inset-shadow"), h = Pt("text-shadow"), p = Pt("drop-shadow"), v = Pt("blur"), g = Pt("perspective"), y = Pt("aspect"), _ = Pt("ease"), k = Pt("animate"), S = () => ["auto", "avoid", "all", "avoid-page", "page", "left", "right", "column"], b = () => [
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "top-left",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "left-top",
    "top-right",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "right-top",
    "bottom-right",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "right-bottom",
    "bottom-left",
    // Deprecated since Tailwind CSS v4.1.0, see https://github.com/tailwindlabs/tailwindcss/pull/17378
    "left-bottom"
  ], $ = () => [...b(), Pe, Oe], E = () => ["auto", "hidden", "clip", "visible", "scroll"], C = () => ["auto", "contain", "none"], w = () => [Pe, Oe, c], O = () => [In, "full", "auto", ...w()], A = () => [Gr, "none", "subgrid", Pe, Oe], R = () => ["auto", {
    span: ["full", Gr, Pe, Oe]
  }, Gr, Pe, Oe], W = () => [Gr, "auto", Pe, Oe], q = () => ["auto", "min", "max", "fr", Pe, Oe], P = () => ["start", "end", "center", "between", "around", "evenly", "stretch", "baseline", "center-safe", "end-safe"], H = () => ["start", "end", "center", "stretch", "center-safe", "end-safe"], V = () => ["auto", ...w()], Y = () => [In, "auto", "full", "dvw", "dvh", "lvw", "lvh", "svw", "svh", "min", "max", "fit", ...w()], oe = () => [l, In, "screen", "full", "dvw", "lvw", "svw", "min", "max", "fit", ...w()], X = () => [In, "screen", "full", "lh", "dvh", "lvh", "svh", "min", "max", "fit", ...w()], I = () => [e, Pe, Oe], te = () => [...b(), wd, _d, {
    position: [Pe, Oe]
  }], F = () => ["no-repeat", {
    repeat: ["", "x", "y", "space", "round"]
  }], Q = () => ["auto", "cover", "contain", Px, Mx, {
    size: [Pe, Oe]
  }], pe = () => [Qa, ds, so], fe = () => [
    // Deprecated since Tailwind CSS v4.0.0
    "",
    "none",
    "full",
    u,
    Pe,
    Oe
  ], G = () => ["", rt, ds, so], ve = () => ["solid", "dashed", "dotted", "double"], ke = () => ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"], se = () => [rt, Qa, wd, _d], ye = () => [
    // Deprecated since Tailwind CSS v4.0.0
    "",
    "none",
    v,
    Pe,
    Oe
  ], U = () => ["none", rt, Pe, Oe], ee = () => ["none", rt, Pe, Oe], ue = () => [rt, Pe, Oe], me = () => [In, "full", ...w()];
  return {
    cacheSize: 500,
    theme: {
      animate: ["spin", "ping", "pulse", "bounce"],
      aspect: ["video"],
      blur: [un],
      breakpoint: [un],
      color: [jp],
      container: [un],
      "drop-shadow": [un],
      ease: ["in", "out", "in-out"],
      font: [Ax],
      "font-weight": ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"],
      "inset-shadow": [un],
      leading: ["none", "tight", "snug", "normal", "relaxed", "loose"],
      perspective: ["dramatic", "near", "normal", "midrange", "distant", "none"],
      radius: [un],
      shadow: [un],
      spacing: ["px", rt],
      text: [un],
      "text-shadow": [un],
      tracking: ["tighter", "tight", "normal", "wide", "wider", "widest"]
    },
    classGroups: {
      // --------------
      // --- Layout ---
      // --------------
      /**
       * Aspect Ratio
       * @see https://tailwindcss.com/docs/aspect-ratio
       */
      aspect: [{
        aspect: ["auto", "square", In, Oe, Pe, y]
      }],
      /**
       * Container
       * @see https://tailwindcss.com/docs/container
       * @deprecated since Tailwind CSS v4.0.0
       */
      container: ["container"],
      /**
       * Container Type
       * @see https://tailwindcss.com/docs/responsive-design#container-queries
       */
      "container-type": [{
        "@container": ["", "normal", "size", Pe, Oe]
      }],
      /**
       * Container Name
       * @see https://tailwindcss.com/docs/responsive-design#named-containers
       */
      "container-named": [Ex],
      /**
       * Columns
       * @see https://tailwindcss.com/docs/columns
       */
      columns: [{
        columns: [rt, "auto", Oe, Pe, l]
      }],
      /**
       * Break After
       * @see https://tailwindcss.com/docs/break-after
       */
      "break-after": [{
        "break-after": S()
      }],
      /**
       * Break Before
       * @see https://tailwindcss.com/docs/break-before
       */
      "break-before": [{
        "break-before": S()
      }],
      /**
       * Break Inside
       * @see https://tailwindcss.com/docs/break-inside
       */
      "break-inside": [{
        "break-inside": ["auto", "avoid", "avoid-page", "avoid-column"]
      }],
      /**
       * Box Decoration Break
       * @see https://tailwindcss.com/docs/box-decoration-break
       */
      "box-decoration": [{
        "box-decoration": ["slice", "clone"]
      }],
      /**
       * Box Sizing
       * @see https://tailwindcss.com/docs/box-sizing
       */
      box: [{
        box: ["border", "content"]
      }],
      /**
       * Display
       * @see https://tailwindcss.com/docs/display
       */
      display: ["block", "inline-block", "inline", "flex", "inline-flex", "table", "inline-table", "table-caption", "table-cell", "table-column", "table-column-group", "table-footer-group", "table-header-group", "table-row-group", "table-row", "flow-root", "grid", "inline-grid", "contents", "list-item", "hidden"],
      /**
       * Screen Reader Only
       * @see https://tailwindcss.com/docs/display#screen-reader-only
       */
      sr: ["sr-only", "not-sr-only"],
      /**
       * Floats
       * @see https://tailwindcss.com/docs/float
       */
      float: [{
        float: ["right", "left", "none", "start", "end"]
      }],
      /**
       * Clear
       * @see https://tailwindcss.com/docs/clear
       */
      clear: [{
        clear: ["left", "right", "both", "none", "start", "end"]
      }],
      /**
       * Isolation
       * @see https://tailwindcss.com/docs/isolation
       */
      isolation: ["isolate", "isolation-auto"],
      /**
       * Object Fit
       * @see https://tailwindcss.com/docs/object-fit
       */
      "object-fit": [{
        object: ["contain", "cover", "fill", "none", "scale-down"]
      }],
      /**
       * Object Position
       * @see https://tailwindcss.com/docs/object-position
       */
      "object-position": [{
        object: $()
      }],
      /**
       * Overflow
       * @see https://tailwindcss.com/docs/overflow
       */
      overflow: [{
        overflow: E()
      }],
      /**
       * Overflow X
       * @see https://tailwindcss.com/docs/overflow
       */
      "overflow-x": [{
        "overflow-x": E()
      }],
      /**
       * Overflow Y
       * @see https://tailwindcss.com/docs/overflow
       */
      "overflow-y": [{
        "overflow-y": E()
      }],
      /**
       * Overscroll Behavior
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      overscroll: [{
        overscroll: C()
      }],
      /**
       * Overscroll Behavior X
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      "overscroll-x": [{
        "overscroll-x": C()
      }],
      /**
       * Overscroll Behavior Y
       * @see https://tailwindcss.com/docs/overscroll-behavior
       */
      "overscroll-y": [{
        "overscroll-y": C()
      }],
      /**
       * Position
       * @see https://tailwindcss.com/docs/position
       */
      position: ["static", "fixed", "absolute", "relative", "sticky"],
      /**
       * Inset
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      inset: [{
        inset: O()
      }],
      /**
       * Inset Inline
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-x": [{
        "inset-x": O()
      }],
      /**
       * Inset Block
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-y": [{
        "inset-y": O()
      }],
      /**
       * Inset Inline Start
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       * @todo class group will be renamed to `inset-s` in next major release
       */
      start: [{
        "inset-s": O(),
        /**
         * @deprecated since Tailwind CSS v4.2.0 in favor of `inset-s-*` utilities.
         * @see https://github.com/tailwindlabs/tailwindcss/pull/19613
         */
        start: O()
      }],
      /**
       * Inset Inline End
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       * @todo class group will be renamed to `inset-e` in next major release
       */
      end: [{
        "inset-e": O(),
        /**
         * @deprecated since Tailwind CSS v4.2.0 in favor of `inset-e-*` utilities.
         * @see https://github.com/tailwindlabs/tailwindcss/pull/19613
         */
        end: O()
      }],
      /**
       * Inset Block Start
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-bs": [{
        "inset-bs": O()
      }],
      /**
       * Inset Block End
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      "inset-be": [{
        "inset-be": O()
      }],
      /**
       * Top
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      top: [{
        top: O()
      }],
      /**
       * Right
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      right: [{
        right: O()
      }],
      /**
       * Bottom
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      bottom: [{
        bottom: O()
      }],
      /**
       * Left
       * @see https://tailwindcss.com/docs/top-right-bottom-left
       */
      left: [{
        left: O()
      }],
      /**
       * Visibility
       * @see https://tailwindcss.com/docs/visibility
       */
      visibility: ["visible", "invisible", "collapse"],
      /**
       * Z-Index
       * @see https://tailwindcss.com/docs/z-index
       */
      z: [{
        z: [Gr, "auto", Pe, Oe]
      }],
      // ------------------------
      // --- Flexbox and Grid ---
      // ------------------------
      /**
       * Flex Basis
       * @see https://tailwindcss.com/docs/flex-basis
       */
      basis: [{
        basis: [In, "full", "auto", l, ...w()]
      }],
      /**
       * Flex Direction
       * @see https://tailwindcss.com/docs/flex-direction
       */
      "flex-direction": [{
        flex: ["row", "row-reverse", "col", "col-reverse"]
      }],
      /**
       * Flex Wrap
       * @see https://tailwindcss.com/docs/flex-wrap
       */
      "flex-wrap": [{
        flex: ["nowrap", "wrap", "wrap-reverse"]
      }],
      /**
       * Flex
       * @see https://tailwindcss.com/docs/flex
       */
      flex: [{
        flex: [rt, In, "auto", "initial", "none", Oe]
      }],
      /**
       * Flex Grow
       * @see https://tailwindcss.com/docs/flex-grow
       */
      grow: [{
        grow: ["", rt, Pe, Oe]
      }],
      /**
       * Flex Shrink
       * @see https://tailwindcss.com/docs/flex-shrink
       */
      shrink: [{
        shrink: ["", rt, Pe, Oe]
      }],
      /**
       * Order
       * @see https://tailwindcss.com/docs/order
       */
      order: [{
        order: [Gr, "first", "last", "none", Pe, Oe]
      }],
      /**
       * Grid Template Columns
       * @see https://tailwindcss.com/docs/grid-template-columns
       */
      "grid-cols": [{
        "grid-cols": A()
      }],
      /**
       * Grid Column Start / End
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-start-end": [{
        col: R()
      }],
      /**
       * Grid Column Start
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-start": [{
        "col-start": W()
      }],
      /**
       * Grid Column End
       * @see https://tailwindcss.com/docs/grid-column
       */
      "col-end": [{
        "col-end": W()
      }],
      /**
       * Grid Template Rows
       * @see https://tailwindcss.com/docs/grid-template-rows
       */
      "grid-rows": [{
        "grid-rows": A()
      }],
      /**
       * Grid Row Start / End
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-start-end": [{
        row: R()
      }],
      /**
       * Grid Row Start
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-start": [{
        "row-start": W()
      }],
      /**
       * Grid Row End
       * @see https://tailwindcss.com/docs/grid-row
       */
      "row-end": [{
        "row-end": W()
      }],
      /**
       * Grid Auto Flow
       * @see https://tailwindcss.com/docs/grid-auto-flow
       */
      "grid-flow": [{
        "grid-flow": ["row", "col", "dense", "row-dense", "col-dense"]
      }],
      /**
       * Grid Auto Columns
       * @see https://tailwindcss.com/docs/grid-auto-columns
       */
      "auto-cols": [{
        "auto-cols": q()
      }],
      /**
       * Grid Auto Rows
       * @see https://tailwindcss.com/docs/grid-auto-rows
       */
      "auto-rows": [{
        "auto-rows": q()
      }],
      /**
       * Gap
       * @see https://tailwindcss.com/docs/gap
       */
      gap: [{
        gap: w()
      }],
      /**
       * Gap X
       * @see https://tailwindcss.com/docs/gap
       */
      "gap-x": [{
        "gap-x": w()
      }],
      /**
       * Gap Y
       * @see https://tailwindcss.com/docs/gap
       */
      "gap-y": [{
        "gap-y": w()
      }],
      /**
       * Justify Content
       * @see https://tailwindcss.com/docs/justify-content
       */
      "justify-content": [{
        justify: [...P(), "normal"]
      }],
      /**
       * Justify Items
       * @see https://tailwindcss.com/docs/justify-items
       */
      "justify-items": [{
        "justify-items": [...H(), "normal"]
      }],
      /**
       * Justify Self
       * @see https://tailwindcss.com/docs/justify-self
       */
      "justify-self": [{
        "justify-self": ["auto", ...H()]
      }],
      /**
       * Align Content
       * @see https://tailwindcss.com/docs/align-content
       */
      "align-content": [{
        content: ["normal", ...P()]
      }],
      /**
       * Align Items
       * @see https://tailwindcss.com/docs/align-items
       */
      "align-items": [{
        items: [...H(), {
          baseline: ["", "last"]
        }]
      }],
      /**
       * Align Self
       * @see https://tailwindcss.com/docs/align-self
       */
      "align-self": [{
        self: ["auto", ...H(), {
          baseline: ["", "last"]
        }]
      }],
      /**
       * Place Content
       * @see https://tailwindcss.com/docs/place-content
       */
      "place-content": [{
        "place-content": P()
      }],
      /**
       * Place Items
       * @see https://tailwindcss.com/docs/place-items
       */
      "place-items": [{
        "place-items": [...H(), "baseline"]
      }],
      /**
       * Place Self
       * @see https://tailwindcss.com/docs/place-self
       */
      "place-self": [{
        "place-self": ["auto", ...H()]
      }],
      // Spacing
      /**
       * Padding
       * @see https://tailwindcss.com/docs/padding
       */
      p: [{
        p: w()
      }],
      /**
       * Padding Inline
       * @see https://tailwindcss.com/docs/padding
       */
      px: [{
        px: w()
      }],
      /**
       * Padding Block
       * @see https://tailwindcss.com/docs/padding
       */
      py: [{
        py: w()
      }],
      /**
       * Padding Inline Start
       * @see https://tailwindcss.com/docs/padding
       */
      ps: [{
        ps: w()
      }],
      /**
       * Padding Inline End
       * @see https://tailwindcss.com/docs/padding
       */
      pe: [{
        pe: w()
      }],
      /**
       * Padding Block Start
       * @see https://tailwindcss.com/docs/padding
       */
      pbs: [{
        pbs: w()
      }],
      /**
       * Padding Block End
       * @see https://tailwindcss.com/docs/padding
       */
      pbe: [{
        pbe: w()
      }],
      /**
       * Padding Top
       * @see https://tailwindcss.com/docs/padding
       */
      pt: [{
        pt: w()
      }],
      /**
       * Padding Right
       * @see https://tailwindcss.com/docs/padding
       */
      pr: [{
        pr: w()
      }],
      /**
       * Padding Bottom
       * @see https://tailwindcss.com/docs/padding
       */
      pb: [{
        pb: w()
      }],
      /**
       * Padding Left
       * @see https://tailwindcss.com/docs/padding
       */
      pl: [{
        pl: w()
      }],
      /**
       * Margin
       * @see https://tailwindcss.com/docs/margin
       */
      m: [{
        m: V()
      }],
      /**
       * Margin Inline
       * @see https://tailwindcss.com/docs/margin
       */
      mx: [{
        mx: V()
      }],
      /**
       * Margin Block
       * @see https://tailwindcss.com/docs/margin
       */
      my: [{
        my: V()
      }],
      /**
       * Margin Inline Start
       * @see https://tailwindcss.com/docs/margin
       */
      ms: [{
        ms: V()
      }],
      /**
       * Margin Inline End
       * @see https://tailwindcss.com/docs/margin
       */
      me: [{
        me: V()
      }],
      /**
       * Margin Block Start
       * @see https://tailwindcss.com/docs/margin
       */
      mbs: [{
        mbs: V()
      }],
      /**
       * Margin Block End
       * @see https://tailwindcss.com/docs/margin
       */
      mbe: [{
        mbe: V()
      }],
      /**
       * Margin Top
       * @see https://tailwindcss.com/docs/margin
       */
      mt: [{
        mt: V()
      }],
      /**
       * Margin Right
       * @see https://tailwindcss.com/docs/margin
       */
      mr: [{
        mr: V()
      }],
      /**
       * Margin Bottom
       * @see https://tailwindcss.com/docs/margin
       */
      mb: [{
        mb: V()
      }],
      /**
       * Margin Left
       * @see https://tailwindcss.com/docs/margin
       */
      ml: [{
        ml: V()
      }],
      /**
       * Space Between X
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-x": [{
        "space-x": w()
      }],
      /**
       * Space Between X Reverse
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-x-reverse": ["space-x-reverse"],
      /**
       * Space Between Y
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-y": [{
        "space-y": w()
      }],
      /**
       * Space Between Y Reverse
       * @see https://tailwindcss.com/docs/margin#adding-space-between-children
       */
      "space-y-reverse": ["space-y-reverse"],
      // --------------
      // --- Sizing ---
      // --------------
      /**
       * Size
       * @see https://tailwindcss.com/docs/width#setting-both-width-and-height
       */
      size: [{
        size: Y()
      }],
      /**
       * Inline Size
       * @see https://tailwindcss.com/docs/inline-size
       */
      "inline-size": [{
        inline: ["auto", ...oe()]
      }],
      /**
       * Min-Inline Size
       * @see https://tailwindcss.com/docs/min-inline-size
       */
      "min-inline-size": [{
        "min-inline": ["auto", ...oe()]
      }],
      /**
       * Max-Inline Size
       * @see https://tailwindcss.com/docs/max-inline-size
       */
      "max-inline-size": [{
        "max-inline": ["none", ...oe()]
      }],
      /**
       * Block Size
       * @see https://tailwindcss.com/docs/block-size
       */
      "block-size": [{
        block: ["auto", ...X()]
      }],
      /**
       * Min-Block Size
       * @see https://tailwindcss.com/docs/min-block-size
       */
      "min-block-size": [{
        "min-block": ["auto", ...X()]
      }],
      /**
       * Max-Block Size
       * @see https://tailwindcss.com/docs/max-block-size
       */
      "max-block-size": [{
        "max-block": ["none", ...X()]
      }],
      /**
       * Width
       * @see https://tailwindcss.com/docs/width
       */
      w: [{
        w: [l, "screen", ...Y()]
      }],
      /**
       * Min-Width
       * @see https://tailwindcss.com/docs/min-width
       */
      "min-w": [{
        "min-w": [
          l,
          "screen",
          /** Deprecated. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
          "none",
          ...Y()
        ]
      }],
      /**
       * Max-Width
       * @see https://tailwindcss.com/docs/max-width
       */
      "max-w": [{
        "max-w": [
          l,
          "screen",
          "none",
          /** Deprecated since Tailwind CSS v4.0.0. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
          "prose",
          /** Deprecated since Tailwind CSS v4.0.0. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
          {
            screen: [i]
          },
          ...Y()
        ]
      }],
      /**
       * Height
       * @see https://tailwindcss.com/docs/height
       */
      h: [{
        h: ["screen", "lh", ...Y()]
      }],
      /**
       * Min-Height
       * @see https://tailwindcss.com/docs/min-height
       */
      "min-h": [{
        "min-h": ["screen", "lh", "none", ...Y()]
      }],
      /**
       * Max-Height
       * @see https://tailwindcss.com/docs/max-height
       */
      "max-h": [{
        "max-h": ["screen", "lh", "none", ...Y()]
      }],
      // ------------------
      // --- Typography ---
      // ------------------
      /**
       * Font Size
       * @see https://tailwindcss.com/docs/font-size
       */
      "font-size": [{
        text: ["base", r, ds, so]
      }],
      /**
       * Font Smoothing
       * @see https://tailwindcss.com/docs/font-smoothing
       */
      "font-smoothing": ["antialiased", "subpixel-antialiased"],
      /**
       * Font Style
       * @see https://tailwindcss.com/docs/font-style
       */
      "font-style": ["italic", "not-italic"],
      /**
       * Font Weight
       * @see https://tailwindcss.com/docs/font-weight
       */
      "font-weight": [{
        font: [n, Rx, Tx]
      }],
      /**
       * Font Stretch
       * @see https://tailwindcss.com/docs/font-stretch
       */
      "font-stretch": [{
        "font-stretch": ["ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "normal", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded", Qa, Oe]
      }],
      /**
       * Font Family
       * @see https://tailwindcss.com/docs/font-family
       */
      "font-family": [{
        font: [Nx, Cx, t]
      }],
      /**
       * Font Feature Settings
       * @see https://tailwindcss.com/docs/font-feature-settings
       */
      "font-features": [{
        "font-features": [Oe]
      }],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-normal": ["normal-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-ordinal": ["ordinal"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-slashed-zero": ["slashed-zero"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-figure": ["lining-nums", "oldstyle-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-spacing": ["proportional-nums", "tabular-nums"],
      /**
       * Font Variant Numeric
       * @see https://tailwindcss.com/docs/font-variant-numeric
       */
      "fvn-fraction": ["diagonal-fractions", "stacked-fractions"],
      /**
       * Letter Spacing
       * @see https://tailwindcss.com/docs/letter-spacing
       */
      tracking: [{
        tracking: [o, Pe, Oe]
      }],
      /**
       * Line Clamp
       * @see https://tailwindcss.com/docs/line-clamp
       */
      "line-clamp": [{
        "line-clamp": [rt, "none", Pe, yd]
      }],
      /**
       * Line Height
       * @see https://tailwindcss.com/docs/line-height
       */
      leading: [{
        leading: [
          "none",
          /** Deprecated since Tailwind CSS v4.0.0. @see https://github.com/tailwindlabs/tailwindcss.com/issues/2027#issuecomment-2620152757 */
          s,
          ...w()
        ]
      }],
      /**
       * List Style Image
       * @see https://tailwindcss.com/docs/list-style-image
       */
      "list-image": [{
        "list-image": ["none", Pe, Oe]
      }],
      /**
       * List Style Position
       * @see https://tailwindcss.com/docs/list-style-position
       */
      "list-style-position": [{
        list: ["inside", "outside"]
      }],
      /**
       * List Style Type
       * @see https://tailwindcss.com/docs/list-style-type
       */
      "list-style-type": [{
        list: ["disc", "decimal", "none", Pe, Oe]
      }],
      /**
       * Text Alignment
       * @see https://tailwindcss.com/docs/text-align
       */
      "text-alignment": [{
        text: ["left", "center", "right", "justify", "start", "end"]
      }],
      /**
       * Placeholder Color
       * @deprecated since Tailwind CSS v3.0.0
       * @see https://v3.tailwindcss.com/docs/placeholder-color
       */
      "placeholder-color": [{
        placeholder: I()
      }],
      /**
       * Text Color
       * @see https://tailwindcss.com/docs/text-color
       */
      "text-color": [{
        text: I()
      }],
      /**
       * Text Decoration
       * @see https://tailwindcss.com/docs/text-decoration
       */
      "text-decoration": ["underline", "overline", "line-through", "no-underline"],
      /**
       * Text Decoration Style
       * @see https://tailwindcss.com/docs/text-decoration-style
       */
      "text-decoration-style": [{
        decoration: [...ve(), "wavy"]
      }],
      /**
       * Text Decoration Thickness
       * @see https://tailwindcss.com/docs/text-decoration-thickness
       */
      "text-decoration-thickness": [{
        decoration: [rt, "from-font", "auto", Pe, so]
      }],
      /**
       * Text Decoration Color
       * @see https://tailwindcss.com/docs/text-decoration-color
       */
      "text-decoration-color": [{
        decoration: I()
      }],
      /**
       * Text Underline Offset
       * @see https://tailwindcss.com/docs/text-underline-offset
       */
      "underline-offset": [{
        "underline-offset": [rt, "auto", Pe, Oe]
      }],
      /**
       * Text Transform
       * @see https://tailwindcss.com/docs/text-transform
       */
      "text-transform": ["uppercase", "lowercase", "capitalize", "normal-case"],
      /**
       * Text Overflow
       * @see https://tailwindcss.com/docs/text-overflow
       */
      "text-overflow": ["truncate", "text-ellipsis", "text-clip"],
      /**
       * Text Wrap
       * @see https://tailwindcss.com/docs/text-wrap
       */
      "text-wrap": [{
        text: ["wrap", "nowrap", "balance", "pretty"]
      }],
      /**
       * Text Indent
       * @see https://tailwindcss.com/docs/text-indent
       */
      indent: [{
        indent: w()
      }],
      /**
       * Tab Size
       * @see https://tailwindcss.com/docs/tab-size
       */
      "tab-size": [{
        tab: [Gr, Pe, Oe]
      }],
      /**
       * Vertical Alignment
       * @see https://tailwindcss.com/docs/vertical-align
       */
      "vertical-align": [{
        align: ["baseline", "top", "middle", "bottom", "text-top", "text-bottom", "sub", "super", Pe, Oe]
      }],
      /**
       * Whitespace
       * @see https://tailwindcss.com/docs/whitespace
       */
      whitespace: [{
        whitespace: ["normal", "nowrap", "pre", "pre-line", "pre-wrap", "break-spaces"]
      }],
      /**
       * Word Break
       * @see https://tailwindcss.com/docs/word-break
       */
      break: [{
        break: ["normal", "words", "all", "keep"]
      }],
      /**
       * Overflow Wrap
       * @see https://tailwindcss.com/docs/overflow-wrap
       */
      wrap: [{
        wrap: ["break-word", "anywhere", "normal"]
      }],
      /**
       * Hyphens
       * @see https://tailwindcss.com/docs/hyphens
       */
      hyphens: [{
        hyphens: ["none", "manual", "auto"]
      }],
      /**
       * Content
       * @see https://tailwindcss.com/docs/content
       */
      content: [{
        content: ["none", Pe, Oe]
      }],
      // -------------------
      // --- Backgrounds ---
      // -------------------
      /**
       * Background Attachment
       * @see https://tailwindcss.com/docs/background-attachment
       */
      "bg-attachment": [{
        bg: ["fixed", "local", "scroll"]
      }],
      /**
       * Background Clip
       * @see https://tailwindcss.com/docs/background-clip
       */
      "bg-clip": [{
        "bg-clip": ["border", "padding", "content", "text"]
      }],
      /**
       * Background Origin
       * @see https://tailwindcss.com/docs/background-origin
       */
      "bg-origin": [{
        "bg-origin": ["border", "padding", "content"]
      }],
      /**
       * Background Position
       * @see https://tailwindcss.com/docs/background-position
       */
      "bg-position": [{
        bg: te()
      }],
      /**
       * Background Repeat
       * @see https://tailwindcss.com/docs/background-repeat
       */
      "bg-repeat": [{
        bg: F()
      }],
      /**
       * Background Size
       * @see https://tailwindcss.com/docs/background-size
       */
      "bg-size": [{
        bg: Q()
      }],
      /**
       * Background Image
       * @see https://tailwindcss.com/docs/background-image
       */
      "bg-image": [{
        bg: ["none", {
          linear: [{
            to: ["t", "tr", "r", "br", "b", "bl", "l", "tl"]
          }, Gr, Pe, Oe],
          radial: ["", Pe, Oe],
          conic: ["", Gr, Pe, Oe]
        }, Ix, Ox]
      }],
      /**
       * Background Color
       * @see https://tailwindcss.com/docs/background-color
       */
      "bg-color": [{
        bg: I()
      }],
      /**
       * Gradient Color Stops From Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-from-pos": [{
        from: pe()
      }],
      /**
       * Gradient Color Stops Via Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-via-pos": [{
        via: pe()
      }],
      /**
       * Gradient Color Stops To Position
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-to-pos": [{
        to: pe()
      }],
      /**
       * Gradient Color Stops From
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-from": [{
        from: I()
      }],
      /**
       * Gradient Color Stops Via
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-via": [{
        via: I()
      }],
      /**
       * Gradient Color Stops To
       * @see https://tailwindcss.com/docs/gradient-color-stops
       */
      "gradient-to": [{
        to: I()
      }],
      // ---------------
      // --- Borders ---
      // ---------------
      /**
       * Border Radius
       * @see https://tailwindcss.com/docs/border-radius
       */
      rounded: [{
        rounded: fe()
      }],
      /**
       * Border Radius Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-s": [{
        "rounded-s": fe()
      }],
      /**
       * Border Radius End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-e": [{
        "rounded-e": fe()
      }],
      /**
       * Border Radius Top
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-t": [{
        "rounded-t": fe()
      }],
      /**
       * Border Radius Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-r": [{
        "rounded-r": fe()
      }],
      /**
       * Border Radius Bottom
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-b": [{
        "rounded-b": fe()
      }],
      /**
       * Border Radius Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-l": [{
        "rounded-l": fe()
      }],
      /**
       * Border Radius Start Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-ss": [{
        "rounded-ss": fe()
      }],
      /**
       * Border Radius Start End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-se": [{
        "rounded-se": fe()
      }],
      /**
       * Border Radius End End
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-ee": [{
        "rounded-ee": fe()
      }],
      /**
       * Border Radius End Start
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-es": [{
        "rounded-es": fe()
      }],
      /**
       * Border Radius Top Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-tl": [{
        "rounded-tl": fe()
      }],
      /**
       * Border Radius Top Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-tr": [{
        "rounded-tr": fe()
      }],
      /**
       * Border Radius Bottom Right
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-br": [{
        "rounded-br": fe()
      }],
      /**
       * Border Radius Bottom Left
       * @see https://tailwindcss.com/docs/border-radius
       */
      "rounded-bl": [{
        "rounded-bl": fe()
      }],
      /**
       * Border Width
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w": [{
        border: G()
      }],
      /**
       * Border Width Inline
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-x": [{
        "border-x": G()
      }],
      /**
       * Border Width Block
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-y": [{
        "border-y": G()
      }],
      /**
       * Border Width Inline Start
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-s": [{
        "border-s": G()
      }],
      /**
       * Border Width Inline End
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-e": [{
        "border-e": G()
      }],
      /**
       * Border Width Block Start
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-bs": [{
        "border-bs": G()
      }],
      /**
       * Border Width Block End
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-be": [{
        "border-be": G()
      }],
      /**
       * Border Width Top
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-t": [{
        "border-t": G()
      }],
      /**
       * Border Width Right
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-r": [{
        "border-r": G()
      }],
      /**
       * Border Width Bottom
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-b": [{
        "border-b": G()
      }],
      /**
       * Border Width Left
       * @see https://tailwindcss.com/docs/border-width
       */
      "border-w-l": [{
        "border-l": G()
      }],
      /**
       * Divide Width X
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-x": [{
        "divide-x": G()
      }],
      /**
       * Divide Width X Reverse
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-x-reverse": ["divide-x-reverse"],
      /**
       * Divide Width Y
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-y": [{
        "divide-y": G()
      }],
      /**
       * Divide Width Y Reverse
       * @see https://tailwindcss.com/docs/border-width#between-children
       */
      "divide-y-reverse": ["divide-y-reverse"],
      /**
       * Border Style
       * @see https://tailwindcss.com/docs/border-style
       */
      "border-style": [{
        border: [...ve(), "hidden", "none"]
      }],
      /**
       * Divide Style
       * @see https://tailwindcss.com/docs/border-style#setting-the-divider-style
       */
      "divide-style": [{
        divide: [...ve(), "hidden", "none"]
      }],
      /**
       * Border Color
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color": [{
        border: I()
      }],
      /**
       * Border Color Inline
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-x": [{
        "border-x": I()
      }],
      /**
       * Border Color Block
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-y": [{
        "border-y": I()
      }],
      /**
       * Border Color Inline Start
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-s": [{
        "border-s": I()
      }],
      /**
       * Border Color Inline End
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-e": [{
        "border-e": I()
      }],
      /**
       * Border Color Block Start
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-bs": [{
        "border-bs": I()
      }],
      /**
       * Border Color Block End
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-be": [{
        "border-be": I()
      }],
      /**
       * Border Color Top
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-t": [{
        "border-t": I()
      }],
      /**
       * Border Color Right
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-r": [{
        "border-r": I()
      }],
      /**
       * Border Color Bottom
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-b": [{
        "border-b": I()
      }],
      /**
       * Border Color Left
       * @see https://tailwindcss.com/docs/border-color
       */
      "border-color-l": [{
        "border-l": I()
      }],
      /**
       * Divide Color
       * @see https://tailwindcss.com/docs/divide-color
       */
      "divide-color": [{
        divide: I()
      }],
      /**
       * Outline Style
       * @see https://tailwindcss.com/docs/outline-style
       */
      "outline-style": [{
        outline: [...ve(), "none", "hidden"]
      }],
      /**
       * Outline Offset
       * @see https://tailwindcss.com/docs/outline-offset
       */
      "outline-offset": [{
        "outline-offset": [rt, Pe, Oe]
      }],
      /**
       * Outline Width
       * @see https://tailwindcss.com/docs/outline-width
       */
      "outline-w": [{
        outline: ["", rt, ds, so]
      }],
      /**
       * Outline Color
       * @see https://tailwindcss.com/docs/outline-color
       */
      "outline-color": [{
        outline: I()
      }],
      // ---------------
      // --- Effects ---
      // ---------------
      /**
       * Box Shadow
       * @see https://tailwindcss.com/docs/box-shadow
       */
      shadow: [{
        shadow: [
          // Deprecated since Tailwind CSS v4.0.0
          "",
          // Deprecated since Tailwind CSS v4.0.0
          "inner",
          "none",
          d,
          vi,
          pi
        ]
      }],
      /**
       * Box Shadow Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-shadow-color
       */
      "shadow-color": [{
        shadow: I()
      }],
      /**
       * Inset Box Shadow
       * @see https://tailwindcss.com/docs/box-shadow#adding-an-inset-shadow
       */
      "inset-shadow": [{
        "inset-shadow": ["none", f, vi, pi]
      }],
      /**
       * Inset Box Shadow Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-inset-shadow-color
       */
      "inset-shadow-color": [{
        "inset-shadow": I()
      }],
      /**
       * Ring Width
       * @see https://tailwindcss.com/docs/box-shadow#adding-a-ring
       */
      "ring-w": [{
        ring: G()
      }],
      /**
       * Ring Width Inset
       * @see https://v3.tailwindcss.com/docs/ring-width#inset-rings
       * @deprecated since Tailwind CSS v4.0.0
       * @see https://github.com/tailwindlabs/tailwindcss/blob/v4.0.0/packages/tailwindcss/src/utilities.ts#L4158
       */
      "ring-w-inset": ["ring-inset"],
      /**
       * Ring Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-ring-color
       */
      "ring-color": [{
        ring: I()
      }],
      /**
       * Ring Offset Width
       * @see https://v3.tailwindcss.com/docs/ring-offset-width
       * @deprecated since Tailwind CSS v4.0.0
       * @see https://github.com/tailwindlabs/tailwindcss/blob/v4.0.0/packages/tailwindcss/src/utilities.ts#L4158
       */
      "ring-offset-w": [{
        "ring-offset": [rt, so]
      }],
      /**
       * Ring Offset Color
       * @see https://v3.tailwindcss.com/docs/ring-offset-color
       * @deprecated since Tailwind CSS v4.0.0
       * @see https://github.com/tailwindlabs/tailwindcss/blob/v4.0.0/packages/tailwindcss/src/utilities.ts#L4158
       */
      "ring-offset-color": [{
        "ring-offset": I()
      }],
      /**
       * Inset Ring Width
       * @see https://tailwindcss.com/docs/box-shadow#adding-an-inset-ring
       */
      "inset-ring-w": [{
        "inset-ring": G()
      }],
      /**
       * Inset Ring Color
       * @see https://tailwindcss.com/docs/box-shadow#setting-the-inset-ring-color
       */
      "inset-ring-color": [{
        "inset-ring": I()
      }],
      /**
       * Text Shadow
       * @see https://tailwindcss.com/docs/text-shadow
       */
      "text-shadow": [{
        "text-shadow": ["none", h, vi, pi]
      }],
      /**
       * Text Shadow Color
       * @see https://tailwindcss.com/docs/text-shadow#setting-the-shadow-color
       */
      "text-shadow-color": [{
        "text-shadow": I()
      }],
      /**
       * Opacity
       * @see https://tailwindcss.com/docs/opacity
       */
      opacity: [{
        opacity: [rt, Pe, Oe]
      }],
      /**
       * Mix Blend Mode
       * @see https://tailwindcss.com/docs/mix-blend-mode
       */
      "mix-blend": [{
        "mix-blend": [...ke(), "plus-darker", "plus-lighter"]
      }],
      /**
       * Background Blend Mode
       * @see https://tailwindcss.com/docs/background-blend-mode
       */
      "bg-blend": [{
        "bg-blend": ke()
      }],
      /**
       * Mask Clip
       * @see https://tailwindcss.com/docs/mask-clip
       */
      "mask-clip": [{
        "mask-clip": ["border", "padding", "content", "fill", "stroke", "view"]
      }, "mask-no-clip"],
      /**
       * Mask Composite
       * @see https://tailwindcss.com/docs/mask-composite
       */
      "mask-composite": [{
        mask: ["add", "subtract", "intersect", "exclude"]
      }],
      /**
       * Mask Image
       * @see https://tailwindcss.com/docs/mask-image
       */
      "mask-image-linear-pos": [{
        "mask-linear": [rt]
      }],
      "mask-image-linear-from-pos": [{
        "mask-linear-from": se()
      }],
      "mask-image-linear-to-pos": [{
        "mask-linear-to": se()
      }],
      "mask-image-linear-from-color": [{
        "mask-linear-from": I()
      }],
      "mask-image-linear-to-color": [{
        "mask-linear-to": I()
      }],
      "mask-image-t-from-pos": [{
        "mask-t-from": se()
      }],
      "mask-image-t-to-pos": [{
        "mask-t-to": se()
      }],
      "mask-image-t-from-color": [{
        "mask-t-from": I()
      }],
      "mask-image-t-to-color": [{
        "mask-t-to": I()
      }],
      "mask-image-r-from-pos": [{
        "mask-r-from": se()
      }],
      "mask-image-r-to-pos": [{
        "mask-r-to": se()
      }],
      "mask-image-r-from-color": [{
        "mask-r-from": I()
      }],
      "mask-image-r-to-color": [{
        "mask-r-to": I()
      }],
      "mask-image-b-from-pos": [{
        "mask-b-from": se()
      }],
      "mask-image-b-to-pos": [{
        "mask-b-to": se()
      }],
      "mask-image-b-from-color": [{
        "mask-b-from": I()
      }],
      "mask-image-b-to-color": [{
        "mask-b-to": I()
      }],
      "mask-image-l-from-pos": [{
        "mask-l-from": se()
      }],
      "mask-image-l-to-pos": [{
        "mask-l-to": se()
      }],
      "mask-image-l-from-color": [{
        "mask-l-from": I()
      }],
      "mask-image-l-to-color": [{
        "mask-l-to": I()
      }],
      "mask-image-x-from-pos": [{
        "mask-x-from": se()
      }],
      "mask-image-x-to-pos": [{
        "mask-x-to": se()
      }],
      "mask-image-x-from-color": [{
        "mask-x-from": I()
      }],
      "mask-image-x-to-color": [{
        "mask-x-to": I()
      }],
      "mask-image-y-from-pos": [{
        "mask-y-from": se()
      }],
      "mask-image-y-to-pos": [{
        "mask-y-to": se()
      }],
      "mask-image-y-from-color": [{
        "mask-y-from": I()
      }],
      "mask-image-y-to-color": [{
        "mask-y-to": I()
      }],
      "mask-image-radial": [{
        "mask-radial": [Pe, Oe]
      }],
      "mask-image-radial-from-pos": [{
        "mask-radial-from": se()
      }],
      "mask-image-radial-to-pos": [{
        "mask-radial-to": se()
      }],
      "mask-image-radial-from-color": [{
        "mask-radial-from": I()
      }],
      "mask-image-radial-to-color": [{
        "mask-radial-to": I()
      }],
      "mask-image-radial-shape": [{
        "mask-radial": ["circle", "ellipse"]
      }],
      "mask-image-radial-size": [{
        "mask-radial": [{
          closest: ["side", "corner"],
          farthest: ["side", "corner"]
        }]
      }],
      "mask-image-radial-pos": [{
        "mask-radial-at": b()
      }],
      "mask-image-conic-pos": [{
        "mask-conic": [rt]
      }],
      "mask-image-conic-from-pos": [{
        "mask-conic-from": se()
      }],
      "mask-image-conic-to-pos": [{
        "mask-conic-to": se()
      }],
      "mask-image-conic-from-color": [{
        "mask-conic-from": I()
      }],
      "mask-image-conic-to-color": [{
        "mask-conic-to": I()
      }],
      /**
       * Mask Mode
       * @see https://tailwindcss.com/docs/mask-mode
       */
      "mask-mode": [{
        mask: ["alpha", "luminance", "match"]
      }],
      /**
       * Mask Origin
       * @see https://tailwindcss.com/docs/mask-origin
       */
      "mask-origin": [{
        "mask-origin": ["border", "padding", "content", "fill", "stroke", "view"]
      }],
      /**
       * Mask Position
       * @see https://tailwindcss.com/docs/mask-position
       */
      "mask-position": [{
        mask: te()
      }],
      /**
       * Mask Repeat
       * @see https://tailwindcss.com/docs/mask-repeat
       */
      "mask-repeat": [{
        mask: F()
      }],
      /**
       * Mask Size
       * @see https://tailwindcss.com/docs/mask-size
       */
      "mask-size": [{
        mask: Q()
      }],
      /**
       * Mask Type
       * @see https://tailwindcss.com/docs/mask-type
       */
      "mask-type": [{
        "mask-type": ["alpha", "luminance"]
      }],
      /**
       * Mask Image
       * @see https://tailwindcss.com/docs/mask-image
       */
      "mask-image": [{
        mask: ["none", Pe, Oe]
      }],
      // ---------------
      // --- Filters ---
      // ---------------
      /**
       * Filter
       * @see https://tailwindcss.com/docs/filter
       */
      filter: [{
        filter: [
          // Deprecated since Tailwind CSS v3.0.0
          "",
          "none",
          Pe,
          Oe
        ]
      }],
      /**
       * Blur
       * @see https://tailwindcss.com/docs/blur
       */
      blur: [{
        blur: ye()
      }],
      /**
       * Brightness
       * @see https://tailwindcss.com/docs/brightness
       */
      brightness: [{
        brightness: [rt, Pe, Oe]
      }],
      /**
       * Contrast
       * @see https://tailwindcss.com/docs/contrast
       */
      contrast: [{
        contrast: [rt, Pe, Oe]
      }],
      /**
       * Drop Shadow
       * @see https://tailwindcss.com/docs/drop-shadow
       */
      "drop-shadow": [{
        "drop-shadow": [
          // Deprecated since Tailwind CSS v4.0.0
          "",
          "none",
          p,
          vi,
          pi
        ]
      }],
      /**
       * Drop Shadow Color
       * @see https://tailwindcss.com/docs/filter-drop-shadow#setting-the-shadow-color
       */
      "drop-shadow-color": [{
        "drop-shadow": I()
      }],
      /**
       * Grayscale
       * @see https://tailwindcss.com/docs/grayscale
       */
      grayscale: [{
        grayscale: ["", rt, Pe, Oe]
      }],
      /**
       * Hue Rotate
       * @see https://tailwindcss.com/docs/hue-rotate
       */
      "hue-rotate": [{
        "hue-rotate": [rt, Pe, Oe]
      }],
      /**
       * Invert
       * @see https://tailwindcss.com/docs/invert
       */
      invert: [{
        invert: ["", rt, Pe, Oe]
      }],
      /**
       * Saturate
       * @see https://tailwindcss.com/docs/saturate
       */
      saturate: [{
        saturate: [rt, Pe, Oe]
      }],
      /**
       * Sepia
       * @see https://tailwindcss.com/docs/sepia
       */
      sepia: [{
        sepia: ["", rt, Pe, Oe]
      }],
      /**
       * Backdrop Filter
       * @see https://tailwindcss.com/docs/backdrop-filter
       */
      "backdrop-filter": [{
        "backdrop-filter": [
          // Deprecated since Tailwind CSS v3.0.0
          "",
          "none",
          Pe,
          Oe
        ]
      }],
      /**
       * Backdrop Blur
       * @see https://tailwindcss.com/docs/backdrop-blur
       */
      "backdrop-blur": [{
        "backdrop-blur": ye()
      }],
      /**
       * Backdrop Brightness
       * @see https://tailwindcss.com/docs/backdrop-brightness
       */
      "backdrop-brightness": [{
        "backdrop-brightness": [rt, Pe, Oe]
      }],
      /**
       * Backdrop Contrast
       * @see https://tailwindcss.com/docs/backdrop-contrast
       */
      "backdrop-contrast": [{
        "backdrop-contrast": [rt, Pe, Oe]
      }],
      /**
       * Backdrop Grayscale
       * @see https://tailwindcss.com/docs/backdrop-grayscale
       */
      "backdrop-grayscale": [{
        "backdrop-grayscale": ["", rt, Pe, Oe]
      }],
      /**
       * Backdrop Hue Rotate
       * @see https://tailwindcss.com/docs/backdrop-hue-rotate
       */
      "backdrop-hue-rotate": [{
        "backdrop-hue-rotate": [rt, Pe, Oe]
      }],
      /**
       * Backdrop Invert
       * @see https://tailwindcss.com/docs/backdrop-invert
       */
      "backdrop-invert": [{
        "backdrop-invert": ["", rt, Pe, Oe]
      }],
      /**
       * Backdrop Opacity
       * @see https://tailwindcss.com/docs/backdrop-opacity
       */
      "backdrop-opacity": [{
        "backdrop-opacity": [rt, Pe, Oe]
      }],
      /**
       * Backdrop Saturate
       * @see https://tailwindcss.com/docs/backdrop-saturate
       */
      "backdrop-saturate": [{
        "backdrop-saturate": [rt, Pe, Oe]
      }],
      /**
       * Backdrop Sepia
       * @see https://tailwindcss.com/docs/backdrop-sepia
       */
      "backdrop-sepia": [{
        "backdrop-sepia": ["", rt, Pe, Oe]
      }],
      // --------------
      // --- Tables ---
      // --------------
      /**
       * Border Collapse
       * @see https://tailwindcss.com/docs/border-collapse
       */
      "border-collapse": [{
        border: ["collapse", "separate"]
      }],
      /**
       * Border Spacing
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing": [{
        "border-spacing": w()
      }],
      /**
       * Border Spacing X
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing-x": [{
        "border-spacing-x": w()
      }],
      /**
       * Border Spacing Y
       * @see https://tailwindcss.com/docs/border-spacing
       */
      "border-spacing-y": [{
        "border-spacing-y": w()
      }],
      /**
       * Table Layout
       * @see https://tailwindcss.com/docs/table-layout
       */
      "table-layout": [{
        table: ["auto", "fixed"]
      }],
      /**
       * Caption Side
       * @see https://tailwindcss.com/docs/caption-side
       */
      caption: [{
        caption: ["top", "bottom"]
      }],
      // ---------------------------------
      // --- Transitions and Animation ---
      // ---------------------------------
      /**
       * Transition Property
       * @see https://tailwindcss.com/docs/transition-property
       */
      transition: [{
        transition: ["", "all", "colors", "opacity", "shadow", "transform", "none", Pe, Oe]
      }],
      /**
       * Transition Behavior
       * @see https://tailwindcss.com/docs/transition-behavior
       */
      "transition-behavior": [{
        transition: ["normal", "discrete"]
      }],
      /**
       * Transition Duration
       * @see https://tailwindcss.com/docs/transition-duration
       */
      duration: [{
        duration: [rt, "initial", Pe, Oe]
      }],
      /**
       * Transition Timing Function
       * @see https://tailwindcss.com/docs/transition-timing-function
       */
      ease: [{
        ease: ["linear", "initial", _, Pe, Oe]
      }],
      /**
       * Transition Delay
       * @see https://tailwindcss.com/docs/transition-delay
       */
      delay: [{
        delay: [rt, Pe, Oe]
      }],
      /**
       * Animation
       * @see https://tailwindcss.com/docs/animation
       */
      animate: [{
        animate: ["none", k, Pe, Oe]
      }],
      // ------------------
      // --- Transforms ---
      // ------------------
      /**
       * Backface Visibility
       * @see https://tailwindcss.com/docs/backface-visibility
       */
      backface: [{
        backface: ["hidden", "visible"]
      }],
      /**
       * Perspective
       * @see https://tailwindcss.com/docs/perspective
       */
      perspective: [{
        perspective: [g, Pe, Oe]
      }],
      /**
       * Perspective Origin
       * @see https://tailwindcss.com/docs/perspective-origin
       */
      "perspective-origin": [{
        "perspective-origin": $()
      }],
      /**
       * Rotate
       * @see https://tailwindcss.com/docs/rotate
       */
      rotate: [{
        rotate: U()
      }],
      /**
       * Rotate X
       * @see https://tailwindcss.com/docs/rotate
       */
      "rotate-x": [{
        "rotate-x": U()
      }],
      /**
       * Rotate Y
       * @see https://tailwindcss.com/docs/rotate
       */
      "rotate-y": [{
        "rotate-y": U()
      }],
      /**
       * Rotate Z
       * @see https://tailwindcss.com/docs/rotate
       */
      "rotate-z": [{
        "rotate-z": U()
      }],
      /**
       * Scale
       * @see https://tailwindcss.com/docs/scale
       */
      scale: [{
        scale: ee()
      }],
      /**
       * Scale X
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-x": [{
        "scale-x": ee()
      }],
      /**
       * Scale Y
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-y": [{
        "scale-y": ee()
      }],
      /**
       * Scale Z
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-z": [{
        "scale-z": ee()
      }],
      /**
       * Scale 3D
       * @see https://tailwindcss.com/docs/scale
       */
      "scale-3d": ["scale-3d"],
      /**
       * Skew
       * @see https://tailwindcss.com/docs/skew
       */
      skew: [{
        skew: ue()
      }],
      /**
       * Skew X
       * @see https://tailwindcss.com/docs/skew
       */
      "skew-x": [{
        "skew-x": ue()
      }],
      /**
       * Skew Y
       * @see https://tailwindcss.com/docs/skew
       */
      "skew-y": [{
        "skew-y": ue()
      }],
      /**
       * Transform
       * @see https://tailwindcss.com/docs/transform
       */
      transform: [{
        transform: [Pe, Oe, "", "none", "gpu", "cpu"]
      }],
      /**
       * Transform Origin
       * @see https://tailwindcss.com/docs/transform-origin
       */
      "transform-origin": [{
        origin: $()
      }],
      /**
       * Transform Style
       * @see https://tailwindcss.com/docs/transform-style
       */
      "transform-style": [{
        transform: ["3d", "flat"]
      }],
      /**
       * Translate
       * @see https://tailwindcss.com/docs/translate
       */
      translate: [{
        translate: me()
      }],
      /**
       * Translate X
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-x": [{
        "translate-x": me()
      }],
      /**
       * Translate Y
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-y": [{
        "translate-y": me()
      }],
      /**
       * Translate Z
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-z": [{
        "translate-z": me()
      }],
      /**
       * Translate None
       * @see https://tailwindcss.com/docs/translate
       */
      "translate-none": ["translate-none"],
      /**
       * Zoom
       * @see https://tailwindcss.com/docs/zoom
       */
      zoom: [{
        zoom: [Gr, Pe, Oe]
      }],
      // ---------------------
      // --- Interactivity ---
      // ---------------------
      /**
       * Accent Color
       * @see https://tailwindcss.com/docs/accent-color
       */
      accent: [{
        accent: I()
      }],
      /**
       * Appearance
       * @see https://tailwindcss.com/docs/appearance
       */
      appearance: [{
        appearance: ["none", "auto"]
      }],
      /**
       * Caret Color
       * @see https://tailwindcss.com/docs/just-in-time-mode#caret-color-utilities
       */
      "caret-color": [{
        caret: I()
      }],
      /**
       * Color Scheme
       * @see https://tailwindcss.com/docs/color-scheme
       */
      "color-scheme": [{
        scheme: ["normal", "dark", "light", "light-dark", "only-dark", "only-light"]
      }],
      /**
       * Cursor
       * @see https://tailwindcss.com/docs/cursor
       */
      cursor: [{
        cursor: ["auto", "default", "pointer", "wait", "text", "move", "help", "not-allowed", "none", "context-menu", "progress", "cell", "crosshair", "vertical-text", "alias", "copy", "no-drop", "grab", "grabbing", "all-scroll", "col-resize", "row-resize", "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize", "zoom-in", "zoom-out", Pe, Oe]
      }],
      /**
       * Field Sizing
       * @see https://tailwindcss.com/docs/field-sizing
       */
      "field-sizing": [{
        "field-sizing": ["fixed", "content"]
      }],
      /**
       * Pointer Events
       * @see https://tailwindcss.com/docs/pointer-events
       */
      "pointer-events": [{
        "pointer-events": ["auto", "none"]
      }],
      /**
       * Resize
       * @see https://tailwindcss.com/docs/resize
       */
      resize: [{
        resize: ["none", "", "y", "x"]
      }],
      /**
       * Scroll Behavior
       * @see https://tailwindcss.com/docs/scroll-behavior
       */
      "scroll-behavior": [{
        scroll: ["auto", "smooth"]
      }],
      /**
       * Scrollbar Thumb Color
       * @see https://tailwindcss.com/docs/scrollbar-color
       */
      "scrollbar-thumb-color": [{
        "scrollbar-thumb": I()
      }],
      /**
       * Scrollbar Track Color
       * @see https://tailwindcss.com/docs/scrollbar-color
       */
      "scrollbar-track-color": [{
        "scrollbar-track": I()
      }],
      /**
       * Scrollbar Gutter
       * @see https://tailwindcss.com/docs/scrollbar-gutter
       */
      "scrollbar-gutter": [{
        "scrollbar-gutter": ["auto", "stable", "both"]
      }],
      /**
       * Scrollbar Width
       * @see https://tailwindcss.com/docs/scrollbar-width
       */
      "scrollbar-w": [{
        scrollbar: ["auto", "thin", "none"]
      }],
      /**
       * Scroll Margin
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-m": [{
        "scroll-m": w()
      }],
      /**
       * Scroll Margin Inline
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mx": [{
        "scroll-mx": w()
      }],
      /**
       * Scroll Margin Block
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-my": [{
        "scroll-my": w()
      }],
      /**
       * Scroll Margin Inline Start
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-ms": [{
        "scroll-ms": w()
      }],
      /**
       * Scroll Margin Inline End
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-me": [{
        "scroll-me": w()
      }],
      /**
       * Scroll Margin Block Start
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mbs": [{
        "scroll-mbs": w()
      }],
      /**
       * Scroll Margin Block End
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mbe": [{
        "scroll-mbe": w()
      }],
      /**
       * Scroll Margin Top
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mt": [{
        "scroll-mt": w()
      }],
      /**
       * Scroll Margin Right
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mr": [{
        "scroll-mr": w()
      }],
      /**
       * Scroll Margin Bottom
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-mb": [{
        "scroll-mb": w()
      }],
      /**
       * Scroll Margin Left
       * @see https://tailwindcss.com/docs/scroll-margin
       */
      "scroll-ml": [{
        "scroll-ml": w()
      }],
      /**
       * Scroll Padding
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-p": [{
        "scroll-p": w()
      }],
      /**
       * Scroll Padding Inline
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-px": [{
        "scroll-px": w()
      }],
      /**
       * Scroll Padding Block
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-py": [{
        "scroll-py": w()
      }],
      /**
       * Scroll Padding Inline Start
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-ps": [{
        "scroll-ps": w()
      }],
      /**
       * Scroll Padding Inline End
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pe": [{
        "scroll-pe": w()
      }],
      /**
       * Scroll Padding Block Start
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pbs": [{
        "scroll-pbs": w()
      }],
      /**
       * Scroll Padding Block End
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pbe": [{
        "scroll-pbe": w()
      }],
      /**
       * Scroll Padding Top
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pt": [{
        "scroll-pt": w()
      }],
      /**
       * Scroll Padding Right
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pr": [{
        "scroll-pr": w()
      }],
      /**
       * Scroll Padding Bottom
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pb": [{
        "scroll-pb": w()
      }],
      /**
       * Scroll Padding Left
       * @see https://tailwindcss.com/docs/scroll-padding
       */
      "scroll-pl": [{
        "scroll-pl": w()
      }],
      /**
       * Scroll Snap Align
       * @see https://tailwindcss.com/docs/scroll-snap-align
       */
      "snap-align": [{
        snap: ["start", "end", "center", "align-none"]
      }],
      /**
       * Scroll Snap Stop
       * @see https://tailwindcss.com/docs/scroll-snap-stop
       */
      "snap-stop": [{
        snap: ["normal", "always"]
      }],
      /**
       * Scroll Snap Type
       * @see https://tailwindcss.com/docs/scroll-snap-type
       */
      "snap-type": [{
        snap: ["none", "x", "y", "both"]
      }],
      /**
       * Scroll Snap Type Strictness
       * @see https://tailwindcss.com/docs/scroll-snap-type
       */
      "snap-strictness": [{
        snap: ["mandatory", "proximity"]
      }],
      /**
       * Touch Action
       * @see https://tailwindcss.com/docs/touch-action
       */
      touch: [{
        touch: ["auto", "none", "manipulation"]
      }],
      /**
       * Touch Action X
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-x": [{
        "touch-pan": ["x", "left", "right"]
      }],
      /**
       * Touch Action Y
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-y": [{
        "touch-pan": ["y", "up", "down"]
      }],
      /**
       * Touch Action Pinch Zoom
       * @see https://tailwindcss.com/docs/touch-action
       */
      "touch-pz": ["touch-pinch-zoom"],
      /**
       * User Select
       * @see https://tailwindcss.com/docs/user-select
       */
      select: [{
        select: ["none", "text", "all", "auto"]
      }],
      /**
       * Will Change
       * @see https://tailwindcss.com/docs/will-change
       */
      "will-change": [{
        "will-change": ["auto", "scroll", "contents", "transform", Pe, Oe]
      }],
      // -----------
      // --- SVG ---
      // -----------
      /**
       * Fill
       * @see https://tailwindcss.com/docs/fill
       */
      fill: [{
        fill: ["none", ...I()]
      }],
      /**
       * Stroke Width
       * @see https://tailwindcss.com/docs/stroke-width
       */
      "stroke-w": [{
        stroke: [rt, ds, so, yd]
      }],
      /**
       * Stroke
       * @see https://tailwindcss.com/docs/stroke
       */
      stroke: [{
        stroke: ["none", ...I()]
      }],
      // ---------------------
      // --- Accessibility ---
      // ---------------------
      /**
       * Forced Color Adjust
       * @see https://tailwindcss.com/docs/forced-color-adjust
       */
      "forced-color-adjust": [{
        "forced-color-adjust": ["auto", "none"]
      }]
    },
    conflictingClassGroups: {
      "container-named": ["container-type"],
      overflow: ["overflow-x", "overflow-y"],
      overscroll: ["overscroll-x", "overscroll-y"],
      inset: ["inset-x", "inset-y", "inset-bs", "inset-be", "start", "end", "top", "right", "bottom", "left"],
      "inset-x": ["start", "end", "right", "left"],
      "inset-y": ["inset-bs", "inset-be", "top", "bottom"],
      flex: ["basis", "grow", "shrink"],
      gap: ["gap-x", "gap-y"],
      p: ["px", "py", "ps", "pe", "pbs", "pbe", "pt", "pr", "pb", "pl"],
      px: ["ps", "pe", "pr", "pl"],
      py: ["pbs", "pbe", "pt", "pb"],
      m: ["mx", "my", "ms", "me", "mbs", "mbe", "mt", "mr", "mb", "ml"],
      mx: ["ms", "me", "mr", "ml"],
      my: ["mbs", "mbe", "mt", "mb"],
      size: ["w", "h"],
      "font-size": ["leading"],
      "fvn-normal": ["fvn-ordinal", "fvn-slashed-zero", "fvn-figure", "fvn-spacing", "fvn-fraction"],
      "fvn-ordinal": ["fvn-normal"],
      "fvn-slashed-zero": ["fvn-normal"],
      "fvn-figure": ["fvn-normal"],
      "fvn-spacing": ["fvn-normal"],
      "fvn-fraction": ["fvn-normal"],
      "line-clamp": ["display", "overflow"],
      rounded: ["rounded-s", "rounded-e", "rounded-t", "rounded-r", "rounded-b", "rounded-l", "rounded-ss", "rounded-se", "rounded-ee", "rounded-es", "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
      "rounded-s": ["rounded-ss", "rounded-es"],
      "rounded-e": ["rounded-se", "rounded-ee"],
      "rounded-t": ["rounded-tl", "rounded-tr"],
      "rounded-r": ["rounded-tr", "rounded-br"],
      "rounded-b": ["rounded-br", "rounded-bl"],
      "rounded-l": ["rounded-tl", "rounded-bl"],
      "border-spacing": ["border-spacing-x", "border-spacing-y"],
      "border-w": ["border-w-x", "border-w-y", "border-w-s", "border-w-e", "border-w-bs", "border-w-be", "border-w-t", "border-w-r", "border-w-b", "border-w-l"],
      "border-w-x": ["border-w-s", "border-w-e", "border-w-r", "border-w-l"],
      "border-w-y": ["border-w-bs", "border-w-be", "border-w-t", "border-w-b"],
      "border-color": ["border-color-x", "border-color-y", "border-color-s", "border-color-e", "border-color-bs", "border-color-be", "border-color-t", "border-color-r", "border-color-b", "border-color-l"],
      "border-color-x": ["border-color-s", "border-color-e", "border-color-r", "border-color-l"],
      "border-color-y": ["border-color-bs", "border-color-be", "border-color-t", "border-color-b"],
      translate: ["translate-x", "translate-y", "translate-none"],
      "translate-none": ["translate", "translate-x", "translate-y", "translate-z"],
      "scroll-m": ["scroll-mx", "scroll-my", "scroll-ms", "scroll-me", "scroll-mbs", "scroll-mbe", "scroll-mt", "scroll-mr", "scroll-mb", "scroll-ml"],
      "scroll-mx": ["scroll-ms", "scroll-me", "scroll-mr", "scroll-ml"],
      "scroll-my": ["scroll-mbs", "scroll-mbe", "scroll-mt", "scroll-mb"],
      "scroll-p": ["scroll-px", "scroll-py", "scroll-ps", "scroll-pe", "scroll-pbs", "scroll-pbe", "scroll-pt", "scroll-pr", "scroll-pb", "scroll-pl"],
      "scroll-px": ["scroll-ps", "scroll-pe", "scroll-pr", "scroll-pl"],
      "scroll-py": ["scroll-pbs", "scroll-pbe", "scroll-pt", "scroll-pb"],
      touch: ["touch-x", "touch-y", "touch-pz"],
      "touch-x": ["touch"],
      "touch-y": ["touch"],
      "touch-pz": ["touch"]
    },
    conflictingClassGroupModifiers: {
      "font-size": ["leading"]
    },
    postfixLookupClassGroups: ["container-type"],
    orderSensitiveModifiers: ["*", "**", "after", "backdrop", "before", "details-content", "file", "first-letter", "first-line", "marker", "placeholder", "selection"]
  };
}, jx = /* @__PURE__ */ gx(Lx);
function sr(...e) {
  return jx($s(e));
}
const kd = Lc({
  base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-3 aria-invalid:ring-3 active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground hover:bg-primary/80",
      outline: "border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground",
      secondary: "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
      ghost: "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground",
      destructive: "bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30",
      link: "text-primary underline-offset-4 hover:underline"
    },
    size: {
      default: "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
      sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
      lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      icon: "size-8",
      "icon-xs": "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
      "icon-sm": "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
      "icon-lg": "size-9"
    }
  },
  defaultVariants: { variant: "default", size: "default" }
});
var Vx = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "class",
  "variant",
  "size",
  "ref",
  "href",
  "type",
  "disabled",
  "children"
]), Fx = /* @__PURE__ */ z("<a><!></a>"), Zx = /* @__PURE__ */ z("<button><!></button>");
function ft(e, t) {
  Ee(t, !0);
  let r = be(t, "variant", 3, "default"), n = be(t, "size", 3, "default"), o = be(t, "ref", 15, null), s = be(t, "href", 3, void 0), i = be(t, "type", 3, "button"), l = /* @__PURE__ */ K(t, Vx);
  var c = Ze(), u = re(c);
  {
    var d = (h) => {
      var p = Fx();
      Et(
        p,
        (g) => ({
          "data-slot": "button",
          class: g,
          href: t.disabled ? void 0 : s(),
          "aria-disabled": t.disabled,
          role: t.disabled ? "link" : void 0,
          tabindex: t.disabled ? -1 : void 0,
          ...l
        }),
        [
          () => sr(kd({ variant: r(), size: n() }), t.class)
        ]
      );
      var v = M(p);
      vt(v, () => t.children ?? dt), _n(p, (g) => o(g), () => o()), x(h, p);
    }, f = (h) => {
      var p = Zx();
      Et(
        p,
        (g) => ({
          "data-slot": "button",
          class: g,
          type: i(),
          disabled: t.disabled,
          ...l
        }),
        [
          () => sr(kd({ variant: r(), size: n() }), t.class)
        ]
      );
      var v = M(p);
      vt(v, () => t.children ?? dt), _n(p, (g) => o(g), () => o()), x(h, p);
    };
    D(u, (h) => {
      s() ? h(d) : h(f, -1);
    });
  }
  x(e, c), Me();
}
var Ux = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function qp(e, t) {
  let r = /* @__PURE__ */ K(t, Ux);
  const n = {
    name: "plug",
    size: 24,
    node: [
      ["path", { d: "M12 22v-5" }],
      ["path", { d: "M15 8V2" }],
      [
        "path",
        {
          d: "M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"
        }
      ],
      ["path", { d: "M9 8V2" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
const Bx = Lc({
  base: "h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none",
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
      secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
      destructive: "bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20",
      outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
      ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
      link: "text-primary underline-offset-4 hover:underline"
    }
  },
  defaultVariants: { variant: "default" }
});
var Wx = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "href",
  "class",
  "variant",
  "children"
]);
function Jt(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = be(t, "variant", 3, "default"), o = /* @__PURE__ */ K(t, Wx);
  var s = Ze(), i = re(s);
  Qh(i, () => t.href ? "a" : "span", !1, (l, c) => {
    _n(l, (f) => r(f), () => r()), Et(
      l,
      (f) => ({
        "data-slot": "badge",
        href: t.href,
        class: f,
        ...o
      }),
      [
        () => sr(Bx({ variant: n() }), t.class)
      ]
    );
    var u = Ze(), d = re(u);
    vt(d, () => t.children ?? dt), x(c, u);
  }), x(e, s), Me();
}
var Hx = ["forEach", "isDisjointFrom", "isSubsetOf", "isSupersetOf"], qx = ["difference", "intersection", "symmetricDifference", "union"], Sd = !1;
class Os extends Set {
  /** @type {Map<T, Source<boolean>>} */
  #e = /* @__PURE__ */ new Map();
  #t = /* @__PURE__ */ he(0);
  #r = /* @__PURE__ */ he(0);
  #o = jr || -1;
  /**
   * @param {Iterable<T> | null | undefined} [value]
   */
  constructor(t) {
    if (super(), t) {
      for (var r of t)
        super.add(r);
      this.#r.v = super.size;
    }
    Sd || this.#s();
  }
  /**
   * If the source is being created inside the same reaction as the SvelteSet instance,
   * we use `state` so that it will not be a dependency of the reaction. Otherwise we
   * use `source` so it will be.
   *
   * @template T
   * @param {T} value
   * @returns {Source<T>}
   */
  #n(t) {
    return jr === this.#o ? /* @__PURE__ */ he(t) : xn(t);
  }
  // We init as part of the first instance so that we can treeshake this class
  #s() {
    Sd = !0;
    var t = Os.prototype, r = Set.prototype;
    for (const n of Hx)
      t[n] = function(...o) {
        return a(this.#t), r[n].apply(this, o);
      };
    for (const n of qx)
      t[n] = function(...o) {
        a(this.#t);
        var s = (
          /** @type {Set<T>} */
          r[n].apply(this, o)
        );
        return new Os(s);
      };
  }
  /** @param {T} value */
  has(t) {
    var r = super.has(t), n = this.#e, o = n.get(t);
    if (o === void 0) {
      if (!r)
        return a(this.#t), !1;
      o = this.#n(!0), n.set(t, o);
    }
    return a(o), r;
  }
  /** @param {T} value */
  add(t) {
    return super.has(t) || (super.add(t), Z(this.#r, super.size), cr(this.#t)), this;
  }
  /** @param {T} value */
  delete(t) {
    var r = super.delete(t), n = this.#e, o = n.get(t);
    return o !== void 0 && (n.delete(t), Z(o, !1)), r && (Z(this.#r, super.size), cr(this.#t)), r;
  }
  clear() {
    if (super.size !== 0) {
      super.clear();
      var t = this.#e;
      for (var r of t.values())
        Z(r, !1);
      t.clear(), Z(this.#r, 0), cr(this.#t);
    }
  }
  keys() {
    return this.values();
  }
  values() {
    return a(this.#t), super.values();
  }
  entries() {
    return a(this.#t), super.entries();
  }
  [Symbol.iterator]() {
    return this.keys();
  }
  get size() {
    return a(this.#r);
  }
}
class $d extends Map {
  /** @type {Map<K, Source<number>>} */
  #e = /* @__PURE__ */ new Map();
  #t = /* @__PURE__ */ he(0);
  #r = /* @__PURE__ */ he(0);
  #o = jr || -1;
  /**
   * @param {Iterable<readonly [K, V]> | null | undefined} [value]
   */
  constructor(t) {
    if (super(), t) {
      for (var [r, n] of t)
        super.set(r, n);
      this.#r.v = super.size;
    }
  }
  /**
   * If the source is being created inside the same reaction as the SvelteMap instance,
   * we use `state` so that it will not be a dependency of the reaction. Otherwise we
   * use `source` so it will be.
   *
   * @template T
   * @param {T} value
   * @returns {Source<T>}
   */
  #n(t) {
    return jr === this.#o ? /* @__PURE__ */ he(t) : xn(t);
  }
  /** @param {K} key */
  has(t) {
    var r = this.#e, n = r.get(t);
    if (n === void 0)
      if (super.has(t))
        n = this.#n(0), r.set(t, n);
      else
        return a(this.#t), !1;
    return a(n), !0;
  }
  /**
   * @param {(value: V, key: K, map: Map<K, V>) => void} callbackfn
   * @param {any} [this_arg]
   */
  forEach(t, r) {
    this.#s(), super.forEach(t, r);
  }
  /** @param {K} key */
  get(t) {
    var r = this.#e, n = r.get(t);
    if (n === void 0)
      if (super.has(t))
        n = this.#n(0), r.set(t, n);
      else {
        a(this.#t);
        return;
      }
    return a(n), super.get(t);
  }
  /**
   * @param {K} key
   * @param {V} value
   * */
  getOrInsert(t, r) {
    return super.has(t) || this.set(t, r), /** @type {V} */
    this.get(t);
  }
  /**
   * @param {K} key
   * @param {(key: K) => V} callbackFn
   */
  getOrInsertComputed(t, r) {
    return super.has(t) || this.set(t, r(t)), /** @type {V} */
    this.get(t);
  }
  /**
   * @param {K} key
   * @param {V} value
   * */
  set(t, r) {
    var n = this.#e, o = n.get(t), s = super.get(t), i = super.set(t, r), l = this.#t;
    if (o === void 0)
      o = this.#n(0), n.set(t, o), Z(this.#r, super.size), cr(l);
    else if (s !== r) {
      cr(o);
      var c = l.reactions === null ? null : new Set(l.reactions), u = c === null || !o.reactions?.every(
        (d) => (
          /** @type {NonNullable<typeof v_reactions>} */
          c.has(d)
        )
      );
      u && cr(l);
    }
    return i;
  }
  /** @param {K} key */
  delete(t) {
    var r = this.#e, n = r.get(t), o = super.delete(t);
    return n !== void 0 && (r.delete(t), Z(n, -1)), o && (Z(this.#r, super.size), cr(this.#t)), o;
  }
  clear() {
    if (super.size !== 0) {
      super.clear();
      var t = this.#e;
      Z(this.#r, 0);
      for (var r of t.values())
        Z(r, -1);
      cr(this.#t), t.clear();
    }
  }
  #s() {
    a(this.#t);
    var t = this.#e;
    if (this.#r.v !== t.size) {
      for (var r of super.keys())
        if (!t.has(r)) {
          var n = this.#n(0);
          t.set(r, n);
        }
    }
    for ([, n] of this.#e)
      a(n);
  }
  keys() {
    return a(this.#t), super.keys();
  }
  values() {
    return this.#s(), super.values();
  }
  entries() {
    return this.#s(), super.entries();
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  get size() {
    return a(this.#r), super.size;
  }
}
const Gp = (e = "") => {
  const t = e.replace(/\/+$/, "");
  return { base: t, fetch: (r, n) => fetch(`${t}${r}`, n) };
};
function Rl(e) {
  const t = Object.values(e).filter((n) => typeof n == "number");
  return Object.entries(e).filter(([n, o]) => t.indexOf(+n) === -1).map(([n, o]) => o);
}
function zd(e, t = "|") {
  return e.map((r) => Qp(r)).join(t);
}
function Dl(e, t) {
  return typeof t == "bigint" ? t.toString() : t;
}
class Gx {
  constructor(t) {
    this._getter = t, this._value = void 0;
  }
  get value() {
    const t = this._getter;
    return t !== void 0 && (this._value = t(), this._getter = void 0), this._value;
  }
}
function wa(e) {
  return new Gx(e);
}
function Kx(e) {
  return e == null;
}
function Fc(e) {
  const t = e.startsWith("^") ? 1 : 0, r = e.endsWith("$") ? e.length - 1 : e.length;
  return e.slice(t, r);
}
function Yx(e, t) {
  const r = e / t, n = Math.round(r), o = 4 * Number.EPSILON * Math.max(Math.abs(r), 1);
  return Math.abs(r - n) < o ? 0 : r - n;
}
function zn(e, t, r) {
  Object.defineProperty(e, t, {
    value: r,
    writable: !0,
    enumerable: !0,
    configurable: !0
  });
}
function Zc(e) {
  const t = Object.getOwnPropertyDescriptor(e, "shape");
  return t?.get ? t.get.raw : t?.value;
}
function wn(e) {
  return Zc(e._zod.def) ?? e._zod.def.shape;
}
function Kp(e, t, r) {
  Object.defineProperty(e, t, {
    get() {
      const n = r();
      return zn(this, t, n), n;
    },
    enumerable: !0,
    configurable: !0
  });
}
function Yp(e, t, r) {
  t in e ? zn(e, t, r) : e[t] = r;
}
function yo(e, t, r, n) {
  const o = wn(t);
  for (const s of r) {
    const i = Object.getOwnPropertyDescriptor(o, s);
    i.enumerable && (i.get ? Kp(e, s, () => {
      const l = t._zod.def.shape[s];
      return n ? n(l, s) : l;
    }) : Yp(e, s, n ? n(i.value, s) : i.value));
  }
}
function Xx(e, t) {
  for (const r of Reflect.ownKeys(t)) {
    const n = Object.getOwnPropertyDescriptor(t, r);
    n.enumerable && (n.get ? Kp(e, r, () => t[r]) : Yp(e, r, n.value));
  }
}
function ur(...e) {
  const t = {};
  for (const r of e) {
    const n = Object.getOwnPropertyDescriptors(r);
    Object.assign(t, n);
  }
  return Object.defineProperties({}, t);
}
function Jx(e) {
  return JSON.stringify(e);
}
function Qx(e) {
  return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const Xp = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {
};
function Ns(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
const ey = /* @__PURE__ */ wa(() => {
  if (Vr.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare"))
    return !1;
  try {
    const e = Function;
    return new e(""), !0;
  } catch {
    return !1;
  }
});
function Bo(e) {
  if (Ns(e) === !1)
    return !1;
  const t = e.constructor;
  if (t === void 0 || typeof t != "function")
    return !0;
  const r = t.prototype;
  return !(Ns(r) === !1 || Object.prototype.hasOwnProperty.call(r, "isPrototypeOf") === !1);
}
function Jp(e) {
  return Bo(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
const ty = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function Wo(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Qn(e, t, r) {
  const n = new e._zod.constr(t ?? e._zod.def);
  return (!t || r?.parent) && (n._zod.parent = e), n;
}
function Ue(e) {
  const t = e;
  if (!t)
    return {};
  if (typeof t == "string")
    return { error: () => t };
  if (t?.message !== void 0) {
    if (t?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    t.error = t.message;
  }
  return delete t.message, typeof t.error == "string" ? { ...t, error: () => t.error } : t;
}
function Qp(e) {
  return typeof e == "bigint" ? e.toString() + "n" : typeof e == "string" ? `"${e}"` : `${e}`;
}
function ry(e) {
  return Object.keys(e).filter((t) => e[t]._zod.optin !== void 0 && e[t]._zod.optout === "optional");
}
const ev = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}, ny = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function oy(e, t) {
  const r = e._zod.def, n = r.checks;
  if (n && n.length > 0)
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  const s = {};
  return yo(s, e, ka(e, t)), Qn(e, ur(r, { shape: s, checks: [] }));
}
function ka(e, t) {
  const r = wn(e), n = [];
  for (const o of Reflect.ownKeys(t)) {
    if (!Object.getOwnPropertyDescriptor(r, o)?.enumerable)
      throw new Error(`Unrecognized key: "${String(o)}"`);
    t[o] && n.push(o);
  }
  return n;
}
function sy(e, t) {
  const r = e._zod.def, n = r.checks;
  if (n && n.length > 0)
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  const s = new Set(ka(e, t)), i = {};
  return yo(i, e, Reflect.ownKeys(wn(e)).filter((l) => !s.has(l))), Qn(e, ur(r, { shape: i, checks: [] }));
}
function iy(e, t) {
  if (!Bo(t))
    throw new Error("Invalid input to extend: expected a plain object");
  const r = e._zod.def.checks;
  if (r && r.length > 0) {
    const o = wn(e);
    for (const s of Reflect.ownKeys(t))
      if (Object.getOwnPropertyDescriptor(o, s) !== void 0)
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
  }
  return Qn(e, ur(e._zod.def, { shape: tv(e, t) }));
}
function tv(e, t) {
  const r = {};
  return yo(r, e, Reflect.ownKeys(wn(e))), Xx(r, t), r;
}
function ay(e, t) {
  if (!Bo(t))
    throw new Error("Invalid input to safeExtend: expected a plain object");
  return Qn(e, ur(e._zod.def, { shape: tv(e, t) }));
}
function ly(e, t) {
  if (!t?._zod?.def)
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  if (e._zod.def.checks?.length)
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  const r = {};
  yo(r, e, Reflect.ownKeys(wn(e))), yo(r, t, Reflect.ownKeys(wn(t)));
  const n = ur(e._zod.def, {
    shape: r,
    get catchall() {
      return t._zod.def.catchall;
    },
    checks: t._zod.def.checks ?? []
  });
  return Qn(e, n);
}
function Ad(e, t, r, n = "partial") {
  const s = t._zod.def.checks;
  if (s && s.length > 0)
    throw new Error(`.${n}() cannot be used on object schemas containing refinements`);
  const l = r ? new Set(ka(t, r)) : void 0, c = {};
  return yo(c, t, Reflect.ownKeys(wn(t)), e && ((u, d) => l && !l.has(d) ? u : new e({ type: "optional", innerType: u }))), Qn(t, ur(t._zod.def, { shape: c, checks: [] }));
}
function cy(e, t, r) {
  const n = r ? new Set(ka(t, r)) : void 0, o = {};
  return yo(o, t, Reflect.ownKeys(wn(t)), (s, i) => (
    // overwrite with non-optional
    n && !n.has(i) ? s : new e({ type: "nonoptional", innerType: s })
  )), Qn(t, ur(t._zod.def, { shape: o }));
}
function vn(e, t = 0) {
  if (e.aborted === !0)
    return !0;
  for (let r = t; r < e.issues.length; r++)
    if (e.issues[r]?.continue !== !0)
      return !0;
  return !1;
}
function uy(e, t = 0) {
  if (e.aborted === !0)
    return !0;
  for (let r = t; r < e.issues.length; r++)
    if (e.issues[r]?.continue === !1)
      return !0;
  return !1;
}
function To(e, t) {
  return t.map((r) => {
    var n;
    return (n = r).path ?? (n.path = []), r.path.unshift(e), r;
  });
}
function fs(e) {
  return typeof e == "string" ? e : e?.message;
}
function Ed(e, t, r) {
  var n;
  for (let o = t; o < e.length; o++)
    (n = e[o]).schema ?? (n.schema = r);
}
function Wn(e, t, r) {
  var n;
  const o = e.inst?._zod?.traits;
  o?.has("$ZodType") && (o.has("$ZodCheck") ? (n = e).schema ?? (n.schema = e.inst) : e.schema = e.inst);
  const s = e.schema !== e.inst ? e.schema?._zod.def?.error : void 0, i = e.message ? e.message : fs(e.inst?._zod.def?.error?.(e)) ?? fs(s?.(e)) ?? fs(t?.error?.(e)) ?? fs(r.customError?.(e)) ?? fs(r.localeError?.(e)) ?? "Invalid input", l = {};
  for (const c of Object.keys(e))
    c === "inst" || c === "schema" || c === "continue" || c === "input" || c === "__proto__" || (l[c] = e[c]);
  return l.path ?? (l.path = []), l.message = i, t?.reportInput && (l.input = e.input), l;
}
const dy = /[\uD800-\uDBFF]/;
function Uc(e) {
  const t = e.length;
  if (!dy.test(e))
    return t;
  let r = t;
  for (let n = 0; n < t - 1; n++)
    (e.charCodeAt(n) & 64512) === 55296 && (e.charCodeAt(n + 1) & 64512) === 56320 && (r--, n++);
  return r;
}
function Bc(e) {
  return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function fy(e) {
  const t = typeof e;
  switch (t) {
    case "number":
      return Number.isNaN(e) ? "nan" : "number";
    case "object": {
      if (e === null)
        return "null";
      if (Array.isArray(e))
        return "array";
      const r = e;
      if (r && Object.getPrototypeOf(r) !== Object.prototype && "constructor" in r && r.constructor)
        return r.constructor.name;
    }
  }
  return t;
}
function Ps(...e) {
  const [t, r, n] = e;
  return typeof t == "string" ? {
    message: t,
    code: "custom",
    input: r,
    inst: n
  } : { ...t };
}
function hy(e, t) {
  for (const r in t) {
    const n = Object.getOwnPropertyDescriptor(t, r);
    n.get ? Object.defineProperty(e, r, { ...n, enumerable: !1 }) : py(e, r, n.value);
  }
}
function Hn(e, t, r, n = !0) {
  return Object.defineProperty(e, t, { configurable: !0, writable: !0, enumerable: n, value: r }), r;
}
function rv(e, t, r) {
  return Hn(e, t, r, !1);
}
function nv(e, t) {
  for (const r in e) {
    const n = e[r];
    Object.defineProperty(t, r, {
      configurable: !0,
      enumerable: !0,
      get() {
        return Hn(this, r, n(this));
      },
      set(o) {
        Hn(this, r, o);
      }
    });
  }
  return t;
}
function py(e, t, r) {
  Object.defineProperty(e, t, {
    configurable: !0,
    get() {
      return this == null ? r : Hn(this, t, r.bind(this));
    },
    set(n) {
      Hn(this, t, n);
    }
  });
}
function vy(e, t) {
  const r = Object.getPrototypeOf(e);
  return t in r ? void 0 : r;
}
let el, Rn = !1;
const gy = {
  configurable: !0,
  get() {
    Rn = !0;
  }
};
function pt(e, t, r) {
  const n = Object.getPrototypeOf(e._zod);
  if (t in n && el !== e._zod) {
    el = void 0;
    return;
  }
  el = e._zod, Object.defineProperty(n, t, {
    configurable: !0,
    get() {
      Object.defineProperty(this, t, gy);
      const o = Rn;
      Rn = !1;
      try {
        const s = r(this);
        return Rn ? delete this[t] : Object.defineProperty(this, t, { configurable: !0, writable: !0, value: s }), Rn = Rn || o, s;
      } catch (s) {
        throw delete this[t], Rn = Rn || o, s;
      }
    },
    set(o) {
      Object.defineProperty(this, t, { configurable: !0, writable: !0, value: o });
    }
  });
}
function my(e, t, r, n) {
  const o = vy(e, t);
  o && Object.defineProperty(o, t, {
    configurable: !0,
    get() {
      const s = { configurable: !0, writable: !0, enumerable: n, value: void 0 };
      return Object.defineProperty(this, t, s), s.value = r(this), Object.defineProperty(this, t, s), s.value;
    },
    set(s) {
      Object.defineProperty(this, t, { configurable: !0, writable: !0, enumerable: n, value: s });
    }
  });
}
const by = "~constantCatch";
function xy(e) {
  const t = () => e;
  return t[by] = !0, t;
}
var Md;
const tl = { value: void 0, enumerable: !1 };
let Td = "captureStackTrace" in Error ? Error : null;
function yy(e) {
  const t = Td;
  if (t) {
    const r = t.stackTraceLimit;
    if (typeof r == "number") {
      try {
        t.stackTraceLimit = 0;
      } catch {
        return Td = null, new e();
      }
      try {
        return new e();
      } finally {
        t.stackTraceLimit = r;
      }
    }
  }
  return new e();
}
function ae(e, t, r, n) {
  const o = {};
  function s(h) {
    this.def = h, this.constr = f, this.traits = /* @__PURE__ */ new Set();
  }
  s.prototype = o;
  const i = r, l = i && /* @__PURE__ */ new WeakSet();
  function c(h, p) {
    if (h._zod) {
      if (h._zod.traits.has(e))
        return;
    } else {
      tl.value = new s(p);
      try {
        Object.defineProperty(h, "_zod", tl);
      } finally {
        tl.value = void 0;
      }
    }
    if (h._zod.traits.add(e), t(h, p), l) {
      const g = Object.getPrototypeOf(h), y = h._zod.constr.prototype;
      let _ = g;
      for (; _ && _ !== y; )
        _ = Object.getPrototypeOf(_);
      const k = _ ?? g;
      l.has(k) || (l.add(k), hy(k, i));
    }
    const v = f.prototype;
    for (const g in v)
      Object.prototype.hasOwnProperty.call(v, g) && (g in h || (h[g] = v[g].bind(h)));
  }
  const u = n?.Parent ?? Object;
  class d extends u {
  }
  Object.defineProperty(d, "name", { value: e });
  function f(h) {
    const p = n?.Parent ? yy(d) : this;
    c(p, h);
    const v = p._zod.deferred;
    if (v) {
      for (const y of v)
        y();
      p._zod.deferred = void 0;
    }
    const g = globalThis.__zod_globalConfig?.postProcessor;
    return g && g(p), p;
  }
  return Object.defineProperty(f, "init", { value: c }), Object.defineProperty(f, Symbol.hasInstance, {
    value: (h) => n?.Parent && h instanceof n.Parent ? !0 : h?._zod?.traits?.has(e)
  }), Object.defineProperty(f, "name", { value: e }), f;
}
class po extends Error {
  constructor() {
    super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
  }
}
class ov extends Error {
  constructor(t) {
    super(`Encountered unidirectional transform during encode: ${t}`), this.name = "ZodEncodeError";
  }
}
(Md = globalThis).__zod_globalConfig ?? (Md.__zod_globalConfig = {});
const Vr = globalThis.__zod_globalConfig;
function sn(e) {
  return e && Object.assign(Vr, e), Vr;
}
function _y() {
  const e = this._zod;
  return e.message ?? (e.message = JSON.stringify(e.def, Dl, 2)), e.message;
}
function wy(e) {
  this._zod.message = e;
}
const ky = {
  get: _y,
  set: wy,
  enumerable: !0,
  configurable: !0
}, rl = { value: void 0, enumerable: !1 }, Cd = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]), Sy = (e, t) => {
  e.name = "$ZodError", rl.value = t, Object.defineProperty(e, "issues", rl), rl.value = void 0, Object.defineProperty(e, "message", ky);
  const r = Object.getPrototypeOf(e);
  Cd.has(r) || (Cd.add(r), Object.defineProperty(r, "toString", {
    configurable: !0,
    enumerable: !1,
    get() {
      const n = () => this.message;
      return Object.defineProperty(this, "toString", { value: n, configurable: !0, writable: !0 }), n;
    },
    set(n) {
      Object.defineProperty(this, "toString", { value: n, configurable: !0, writable: !0 });
    }
  }));
}, $y = ae("$ZodError", Sy);
function zy(e, t, r) {
  return Object.prototype.hasOwnProperty.call(e, t) || (t === "__proto__" ? Object.defineProperty(e, t, { value: r(), writable: !0, enumerable: !0, configurable: !0 }) : e[t] = r()), e[t];
}
function Ay(e, t = (r) => r.message) {
  const r = {}, n = [];
  for (const o of e.issues)
    o.path.length > 0 ? zy(r, o.path[0], () => []).push(t(o)) : n.push(t(o));
  return { formErrors: n, fieldErrors: r };
}
function Ey(e, t = (r) => r.message) {
  const r = { _errors: [] }, n = (o, s = []) => {
    for (const i of o.issues)
      if (i.code === "invalid_union" && i.errors.length)
        i.errors.map((l) => n({ issues: l }, [...s, ...i.path]));
      else if (i.code === "invalid_key")
        n({ issues: i.issues }, [...s, ...i.path]);
      else if (i.code === "invalid_element")
        n({ issues: i.issues }, [...s, ...i.path]);
      else {
        const l = [...s, ...i.path];
        if (l.length === 0)
          r._errors.push(t(i));
        else {
          let c = r, u = 0;
          for (; u < l.length; ) {
            const d = l[u], f = u === l.length - 1;
            if (d === "_errors") {
              f && c._errors.push(t(i)), u++;
              continue;
            }
            Object.prototype.hasOwnProperty.call(c, d) || Object.defineProperty(c, d, {
              value: { _errors: [] },
              enumerable: !0,
              writable: !0,
              configurable: !0
            });
            const h = c[d];
            f && h._errors.push(t(i)), c = h, u++;
          }
        }
      }
  };
  return n(e), r;
}
function Sa(e, t) {
  return { callee: t?.callee ?? e, Err: t?.Err };
}
const Wc = (e) => {
  const t = (r, n, o, s) => {
    const i = o ? { ...o, async: !1 } : { async: !1 }, l = r._zod.run({ value: n, issues: [] }, i);
    if (l instanceof Promise)
      throw new po();
    if (l.issues.length) {
      const c = new (s?.Err ?? e)(l.issues.map((u) => Wn(u, i, sn())));
      throw Xp(c, s?.callee ?? t), c;
    }
    return l.value;
  };
  return t;
}, Hc = (e) => {
  const t = async (r, n, o, s) => {
    const i = o ? { ...o, async: !0 } : { async: !0 };
    let l = r._zod.run({ value: n, issues: [] }, i);
    if (l instanceof Promise && (l = await l), l.issues.length) {
      const c = new (s?.Err ?? e)(l.issues.map((u) => Wn(u, i, sn())));
      throw Xp(c, s?.callee ?? t), c;
    }
    return l.value;
  };
  return t;
}, qc = (e) => (t, r, n) => {
  const o = n ? { ...n, async: !1 } : { async: !1 }, s = t._zod.run({ value: r, issues: [] }, o);
  if (s instanceof Promise)
    throw new po();
  return s.issues.length ? sv(e, s.issues, o) : { success: !0, data: s.value };
};
function sv(e, t, r) {
  let n;
  return {
    success: !1,
    get error() {
      return n || (n = new e(t.map((o) => Wn(o, r, sn()))), t = void 0, r = void 0), n;
    },
    set error(o) {
      n = o, t = void 0, r = void 0;
    }
  };
}
const Gc = (e) => async (t, r, n) => {
  const o = n ? { ...n, async: !0 } : { async: !0 };
  let s = t._zod.run({ value: r, issues: [] }, o);
  return s instanceof Promise && (s = await s), s.issues.length ? sv(e, s.issues, o) : { success: !0, data: s.value };
}, My = /* @__PURE__ */ Symbol.for("zod.compile.invalid"), Ty = /* @__PURE__ */ Symbol.for("zod.compile.fallback"), Cy = ((e, t, r) => {
  const n = e._zod.bag.validator;
  if (n !== void 0) {
    if (n(t) !== My)
      return !0;
    if (n.definite === !0 && r === void 0)
      return !1;
  }
  return Oy(e, t, r);
});
function Oy(e, t, r) {
  const n = r ? { ...r, async: !1, abortEarly: !0 } : { async: !1, abortEarly: !0 }, o = e._zod.bag.fallbackRun;
  let s;
  if (o ? (n[Ty] = !0, s = o({ value: t, issues: [] }, n)) : s = e._zod.run({ value: t, issues: [] }, n), s instanceof Promise)
    throw new po();
  return s.issues.length === 0;
}
const Ny = async (e, t, r) => {
  const n = r ? { ...r, async: !0, abortEarly: !0 } : { async: !0, abortEarly: !0 };
  let o = e._zod.run({ value: t, issues: [] }, n);
  return o instanceof Promise && (o = await o), o.issues.length === 0;
}, Py = (e) => {
  const t = Wc(e), r = (n, o, s, i) => {
    const l = s ? { ...s, direction: "backward" } : { direction: "backward" };
    return t(n, o, l, Sa(r, i));
  };
  return r;
}, Iy = (e) => {
  const t = Wc(e), r = (n, o, s, i) => t(n, o, s, Sa(r, i));
  return r;
}, Ry = (e) => {
  const t = Hc(e), r = async (n, o, s, i) => {
    const l = s ? { ...s, direction: "backward" } : { direction: "backward" };
    return await t(n, o, l, Sa(r, i));
  };
  return r;
}, Dy = (e) => {
  const t = Hc(e), r = async (n, o, s, i) => await t(n, o, s, Sa(r, i));
  return r;
}, Ly = (e) => (t, r, n) => {
  const o = n ? { ...n, direction: "backward" } : { direction: "backward" };
  return qc(e)(t, r, o);
}, jy = (e) => (t, r, n) => qc(e)(t, r, n), Vy = (e) => async (t, r, n) => {
  const o = n ? { ...n, direction: "backward" } : { direction: "backward" };
  return Gc(e)(t, r, o);
}, Fy = (e) => async (t, r, n) => Gc(e)(t, r, n), Zy = /^[cC][0-9a-z]{6,}$/, Uy = /^[0-9a-z]+$/, By = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/, Wy = /^[0-9a-vA-V]{20}$/, Hy = /^[A-Za-z0-9]{27}$/, qy = /^[a-zA-Z0-9_-]{21}$/;
function Gy(e) {
  return new RegExp(`^[a-zA-Z0-9_-]{${e}}$`);
}
const Ky = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, Yy = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, Od = (e) => e ? new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, Xy = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, Jy = "^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$";
function Qy() {
  return new RegExp(Jy, "u");
}
const e_ = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, t_ = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, r_ = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, n_ = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, o_ = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, s_ = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/, i_ = /^https?$/, a_ = /^\+[1-9]\d{6,14}$/, iv = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
function l_(e) {
  return new RegExp(`^${e}$`);
}
const c_ = /* @__PURE__ */ l_(iv);
function Ll(e) {
  const t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
  return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : e.seconds ? `${t}:[0-5]\\d(?:\\.\\d+)?` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function u_(e) {
  return new RegExp(`^${Ll(e)}$`);
}
function d_(e) {
  const t = ["Z"];
  e.offset && t.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
  const r = `${Ll({ precision: e.precision, seconds: !0 })}(?:${t.join("|")})`, n = e.local ? `${r}|${Ll({ precision: e.precision })}` : r;
  return new RegExp(`^${iv}T(?:${n})$`);
}
const f_ = /^[\s\S]{0,}$/, h_ = /^-?\d+$/, Kc = /^-?\d+(?:\.\d+)?$/, p_ = /^(?:true|false)$/i, v_ = /^[^A-Z]*$/, g_ = /^[^a-z]*$/, ir = /* @__PURE__ */ ae("$ZodCheck", (e, t) => {
  var r;
  e._zod ?? (e._zod = {}), e._zod.def = t, (r = e._zod).onattach ?? (r.onattach = []);
}), Yc = (e) => {
  const t = e.value;
  return !Kx(t) && t.length !== void 0;
}, ea = {
  number: "number",
  bigint: "bigint",
  object: "date"
}, av = /* @__PURE__ */ ae("$ZodCheckLessThan", (e, t) => {
  ir.init(e, t);
  const r = ea[typeof t.value];
  e._zod.check = (n) => {
    (t.inclusive ? n.value <= t.value : n.value < t.value) || n.issues.push({
      origin: ea[typeof n.value] ?? r,
      code: "too_big",
      maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
      input: n.value,
      inclusive: t.inclusive,
      inst: e,
      continue: !t.abort
    });
  };
}), lv = /* @__PURE__ */ ae("$ZodCheckGreaterThan", (e, t) => {
  ir.init(e, t);
  const r = ea[typeof t.value];
  e._zod.check = (n) => {
    (t.inclusive ? n.value >= t.value : n.value > t.value) || n.issues.push({
      origin: ea[typeof n.value] ?? r,
      code: "too_small",
      minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
      input: n.value,
      inclusive: t.inclusive,
      inst: e,
      continue: !t.abort
    });
  };
}), m_ = /* @__PURE__ */ ae("$ZodCheckMultipleOf", (e, t) => {
  ir.init(e, t), e._zod.check = (r) => {
    if (typeof r.value != typeof t.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    (typeof r.value == "bigint" ? (
      // `value % 0n` throws, and nothing is a multiple of zero — the number branch already fails this way via NaN
      t.value !== BigInt(0) && r.value % t.value === BigInt(0)
    ) : Yx(r.value, t.value) === 0) || r.issues.push({
      origin: typeof r.value,
      code: "not_multiple_of",
      divisor: t.value,
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), b_ = /* @__PURE__ */ ae("$ZodCheckNumberFormat", (e, t) => {
  ir.init(e, t), t.format = t.format || "float64";
  const r = t.format?.includes("int"), n = r ? "int" : "number", [o, s] = ev[t.format];
  e._zod.check = (i) => {
    const l = i.value;
    if (r) {
      if (!Number.isInteger(l)) {
        i.issues.push({
          expected: n,
          format: t.format,
          code: "invalid_type",
          continue: !1,
          input: l,
          inst: e
        });
        return;
      }
      if (!Number.isSafeInteger(l)) {
        l > 0 ? i.issues.push({
          input: l,
          code: "too_big",
          maximum: Number.MAX_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: n,
          inclusive: !0,
          continue: !t.abort
        }) : i.issues.push({
          input: l,
          code: "too_small",
          minimum: Number.MIN_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: n,
          inclusive: !0,
          continue: !t.abort
        });
        return;
      }
    }
    l < o && i.issues.push({
      origin: "number",
      input: l,
      code: "too_small",
      minimum: o,
      inclusive: !0,
      inst: e,
      continue: !t.abort
    }), l > s && i.issues.push({
      origin: "number",
      input: l,
      code: "too_big",
      maximum: s,
      inclusive: !0,
      inst: e,
      continue: !t.abort
    });
  };
}), x_ = /* @__PURE__ */ ae("$ZodCheckMaxLength", (e, t) => {
  var r;
  ir.init(e, t), (r = e._zod.def).when ?? (r.when = Yc), e._zod.check = (n) => {
    const o = n.value, s = o.length;
    if ((typeof o == "string" && s > t.maximum ? Uc(o) : s) <= t.maximum)
      return;
    const l = Bc(o);
    n.issues.push({
      origin: l,
      code: "too_big",
      maximum: t.maximum,
      inclusive: !0,
      input: o,
      inst: e,
      continue: !t.abort
    });
  };
}), y_ = /* @__PURE__ */ ae("$ZodCheckMinLength", (e, t) => {
  var r;
  ir.init(e, t), (r = e._zod.def).when ?? (r.when = Yc), e._zod.check = (n) => {
    const o = n.value, s = o.length;
    if ((typeof o == "string" && s >= t.minimum && s < t.minimum * 2 ? Uc(o) : s) >= t.minimum)
      return;
    const l = Bc(o);
    n.issues.push({
      origin: l,
      code: "too_small",
      minimum: t.minimum,
      inclusive: !0,
      input: o,
      inst: e,
      continue: !t.abort
    });
  };
}), __ = /* @__PURE__ */ ae("$ZodCheckLengthEquals", (e, t) => {
  var r;
  ir.init(e, t), (r = e._zod.def).when ?? (r.when = Yc), e._zod.check = (n) => {
    const o = n.value, s = o.length, i = typeof o == "string" && s >= t.length && s <= t.length * 2 ? Uc(o) : s;
    if (i === t.length)
      return;
    const l = Bc(o), c = i > t.length;
    n.issues.push({
      origin: l,
      ...c ? { code: "too_big", maximum: t.length } : { code: "too_small", minimum: t.length },
      inclusive: !0,
      exact: !0,
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
}), $a = /* @__PURE__ */ ae("$ZodCheckStringFormat", (e, t) => {
  var r, n;
  ir.init(e, t), t.pattern ? (r = e._zod).check ?? (r.check = (o) => {
    t.pattern.lastIndex = 0, !t.pattern.test(o.value) && o.issues.push({
      origin: "string",
      code: "invalid_format",
      format: t.format,
      input: o.value,
      ...t.pattern ? { pattern: t.pattern.toString() } : {},
      inst: e,
      continue: !t.abort
    });
  }) : (n = e._zod).check ?? (n.check = () => {
  });
}), w_ = /* @__PURE__ */ ae("$ZodCheckRegex", (e, t) => {
  $a.init(e, t), e._zod.check = (r) => {
    t.pattern.lastIndex = 0, !t.pattern.test(r.value) && r.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: r.value,
      pattern: t.pattern.toString(),
      inst: e,
      continue: !t.abort
    });
  };
}), k_ = /* @__PURE__ */ ae("$ZodCheckLowerCase", (e, t) => {
  t.pattern ?? (t.pattern = v_), $a.init(e, t);
}), S_ = /* @__PURE__ */ ae("$ZodCheckUpperCase", (e, t) => {
  t.pattern ?? (t.pattern = g_), $a.init(e, t);
}), $_ = /* @__PURE__ */ ae("$ZodCheckIncludes", (e, t) => {
  ir.init(e, t);
  const r = Wo(t.includes), n = new RegExp(typeof t.position == "number" ? `^.{${t.position},}${r}` : r);
  t.pattern = n, e._zod.check = (o) => {
    o.value.includes(t.includes, t.position) || o.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: t.includes,
      input: o.value,
      inst: e,
      continue: !t.abort
    });
  };
}), z_ = /* @__PURE__ */ ae("$ZodCheckStartsWith", (e, t) => {
  ir.init(e, t);
  const r = new RegExp(`^${Wo(t.prefix)}.*`);
  t.pattern ?? (t.pattern = r), e._zod.check = (n) => {
    n.value.startsWith(t.prefix) || n.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: t.prefix,
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
}), A_ = /* @__PURE__ */ ae("$ZodCheckEndsWith", (e, t) => {
  ir.init(e, t);
  const r = new RegExp(`.*${Wo(t.suffix)}$`);
  t.pattern ?? (t.pattern = r), e._zod.check = (n) => {
    n.value.endsWith(t.suffix) || n.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: t.suffix,
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
}), E_ = /* @__PURE__ */ ae("$ZodCheckOverwrite", (e, t) => {
  ir.init(e, t), e._zod.check = (r) => {
    r.value = t.tx(r.value);
  };
});
class M_ {
  constructor(t = [], r = {}) {
    this.content = [], this.indent = 0, this.args = t, this.closed = r;
  }
  // the compiler catches a child's throw and keeps writing into this doc, so the indent has to unwind with it
  indented(t) {
    this.indent += 1;
    try {
      t(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(t) {
    if (typeof t == "function") {
      t(this, { execution: "sync" }), t(this, { execution: "async" });
      return;
    }
    const n = t.split(`
`).filter((i) => i), o = Math.min(...n.map((i) => i.length - i.trimStart().length)), s = n.map((i) => i.slice(o)).map((i) => " ".repeat(this.indent * 2) + i);
    for (const i of s)
      this.content.push(i);
  }
  compile() {
    const t = Function, r = this?.content ?? [""];
    return new t(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${r.join(`
`)}
};`)(...Object.values(this.closed));
  }
}
const T_ = {
  major: 4,
  minor: 6,
  patch: 5
}, St = /* @__PURE__ */ ae("$ZodType", (e, t) => {
  var r;
  e ?? (e = {}), e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = T_;
  const n = e._zod.def.checks, o = e._zod.traits.has("$ZodCheck") ? [e, ...n ?? []] : n?.length ? [...n] : [];
  for (const s of o)
    for (const i of s._zod.onattach)
      i(e);
  if (o.length === 0)
    (r = e._zod).deferred ?? (r.deferred = []), e._zod.deferred?.push(() => {
      e._zod.run = e._zod.parse;
    });
  else {
    const s = (l, c, u) => {
      if (l.memo)
        return l;
      let d = vn(l), f;
      for (const h of c) {
        if (h._zod.def.when) {
          if (uy(l) || !h._zod.def.when(l))
            continue;
        } else if (d)
          continue;
        const p = l.issues.length, v = h._zod.check(l);
        if (v instanceof Promise && u?.async === !1)
          throw new po();
        if (f || v instanceof Promise)
          f = (f ?? Promise.resolve()).then(async () => {
            await v, l.issues.length !== p && (Ed(l.issues, p, e), d || (d = vn(l, p)));
          });
        else {
          if (l.issues.length === p)
            continue;
          Ed(l.issues, p, e), d || (d = vn(l, p));
        }
      }
      return f ? f.then(() => l) : l;
    }, i = (l, c, u) => {
      if (vn(l))
        return l.aborted = !0, l;
      const d = s(c, o, u);
      if (d instanceof Promise) {
        if (u.async === !1)
          throw new po();
        return d.then((f) => e._zod.parse(f, u));
      }
      return e._zod.parse(d, u);
    };
    e._zod.run = (l, c) => {
      if (c.skipChecks)
        return e._zod.parse(l, c);
      if (c.direction === "backward") {
        const d = e._zod.parse({ value: l.value, issues: [] }, { ...c, skipChecks: !0 });
        return d instanceof Promise ? d.then((f) => i(f, l, c)) : i(d, l, c);
      }
      const u = e._zod.parse(l, c);
      if (u instanceof Promise) {
        if (c.async === !1)
          throw new po();
        return u.then((d) => s(d, o, c));
      }
      return s(u, o, c);
    };
  }
}, {
  // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
  get "~standard"() {
    return rv(this, "~standard", uv(this));
  },
  set "~standard"(e) {
    Hn(this, "~standard", e);
  }
}), cv = (e, t) => e.issues.length ? { issues: e.issues.map((r) => Wn(r, t, sn())) } : { value: e.value };
async function C_(e, t) {
  const r = { async: !0 };
  return cv(await e._zod.run({ value: t, issues: [] }, r), r);
}
function uv(e) {
  return {
    validate: (t) => {
      const r = { async: !1 };
      try {
        const n = e._zod.run({ value: t, issues: [] }, r);
        if (!(n instanceof Promise))
          return cv(n, r);
      } catch {
      }
      return C_(e, t);
    },
    vendor: "zod",
    version: 1
  };
}
const Xc = /* @__PURE__ */ ae("$ZodString", (e, t) => {
  St.init(e, t), e._zod.pattern = t.pattern ?? f_, e._zod.parse = (r, n) => {
    if (t.coerce)
      try {
        r.value = String(r.value);
      } catch {
      }
    return typeof r.value == "string" || r.issues.push({
      expected: "string",
      code: "invalid_type",
      input: r.value,
      inst: e
    }), r;
  };
}), wt = /* @__PURE__ */ ae("$ZodStringFormat", (e, t) => {
  $a.init(e, t), Xc.init(e, t);
}), O_ = /* @__PURE__ */ ae("$ZodGUID", (e, t) => {
  t.pattern ?? (t.pattern = Yy), wt.init(e, t);
}), N_ = /* @__PURE__ */ ae("$ZodUUID", (e, t) => {
  if (t.version) {
    const n = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    }[t.version];
    if (n === void 0)
      throw new Error(`Invalid UUID version: "${t.version}"`);
    t.pattern ?? (t.pattern = Od(n));
  } else
    t.pattern ?? (t.pattern = Od());
  wt.init(e, t);
}), P_ = /* @__PURE__ */ ae("$ZodEmail", (e, t) => {
  t.pattern ?? (t.pattern = Xy), wt.init(e, t);
}), dv = 1, ta = 2;
function fv(e) {
  try {
    return typeof URL < "u" && typeof URL.canParse == "function" ? URL.canParse(e) : (new URL(e), !0);
  } catch {
    return !1;
  }
}
function I_(e, t) {
  return !("normalize" in t) && !("hostname" in t) && !("protocol" in t) ? fv(e) || ta : R_(e, t);
}
function R_(e, t) {
  if (!t.normalize && t.protocol?.source === i_.source && !/^https?:\/\//i.test(e))
    return dv;
  try {
    if (typeof URL < "u") {
      const r = URL;
      if (typeof r.parse == "function")
        return r.parse(e) ?? ta;
    }
    return new URL(e);
  } catch {
    return ta;
  }
}
const D_ = /[\t\n\r]/g;
function Nd(e) {
  return e.replace(D_, "");
}
function L_(e, t) {
  return t.lastIndex = 0, t.test(e.hostname);
}
function j_(e, t) {
  return t.lastIndex = 0, t.test(e.protocol.endsWith(":") ? e.protocol.slice(0, -1) : e.protocol);
}
const V_ = /* @__PURE__ */ ae("$ZodURL", (e, t) => {
  wt.init(e, t), e._zod.check = (r) => {
    try {
      const n = r.value.trim(), o = I_(n, t);
      if (o === dv) {
        r.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: r.value,
          inst: e,
          continue: !t.abort
        });
        return;
      }
      if (o === ta) {
        r.issues.push({
          code: "invalid_format",
          format: "url",
          input: r.value,
          inst: e,
          continue: !t.abort
        });
        return;
      }
      if (o === !0) {
        r.value = Nd(n);
        return;
      }
      t.hostname && !L_(o, t.hostname) && r.issues.push({
        code: "invalid_format",
        format: "url",
        note: "Invalid hostname",
        pattern: t.hostname.source,
        input: r.value,
        inst: e,
        continue: !t.abort
      }), t.protocol && !j_(o, t.protocol) && r.issues.push({
        code: "invalid_format",
        format: "url",
        note: "Invalid protocol",
        pattern: t.protocol.source,
        input: r.value,
        inst: e,
        continue: !t.abort
      }), r.value = t.normalize ? o.href : Nd(n);
      return;
    } catch {
      r.issues.push({
        code: "invalid_format",
        format: "url",
        input: r.value,
        inst: e,
        continue: !t.abort
      });
    }
  };
}), F_ = /* @__PURE__ */ ae("$ZodEmoji", (e, t) => {
  t.pattern ?? (t.pattern = Qy()), wt.init(e, t);
}), Z_ = /* @__PURE__ */ ae("$ZodNanoID", (e, t) => {
  if (t.length !== void 0 && (!Number.isInteger(t.length) || t.length < 1))
    throw new Error(`Invalid nanoid length: ${t.length}`);
  t.pattern ?? (t.pattern = t.length === void 0 ? qy : Gy(t.length)), wt.init(e, t);
}), U_ = /* @__PURE__ */ ae("$ZodCUID", (e, t) => {
  t.pattern ?? (t.pattern = Zy), wt.init(e, t);
}), B_ = /* @__PURE__ */ ae("$ZodCUID2", (e, t) => {
  t.pattern ?? (t.pattern = Uy), wt.init(e, t);
}), W_ = /* @__PURE__ */ ae("$ZodULID", (e, t) => {
  t.pattern ?? (t.pattern = By), wt.init(e, t);
}), H_ = /* @__PURE__ */ ae("$ZodXID", (e, t) => {
  t.pattern ?? (t.pattern = Wy), wt.init(e, t);
}), q_ = /* @__PURE__ */ ae("$ZodKSUID", (e, t) => {
  t.pattern ?? (t.pattern = Hy), wt.init(e, t);
}), G_ = /* @__PURE__ */ ae("$ZodISODateTime", (e, t) => {
  t.pattern ?? (t.pattern = d_(t)), wt.init(e, t);
}), K_ = /* @__PURE__ */ ae("$ZodISODate", (e, t) => {
  t.pattern ?? (t.pattern = c_), wt.init(e, t);
}), Y_ = /* @__PURE__ */ ae("$ZodISOTime", (e, t) => {
  t.pattern ?? (t.pattern = u_(t)), wt.init(e, t);
}), X_ = /* @__PURE__ */ ae("$ZodISODuration", (e, t) => {
  t.pattern ?? (t.pattern = Ky), wt.init(e, t);
}), J_ = /* @__PURE__ */ ae("$ZodIPv4", (e, t) => {
  t.pattern ?? (t.pattern = e_), wt.init(e, t);
}), Q_ = /^[0-9a-fA-F:.]+$/;
function hv(e) {
  return Q_.test(e) ? fv(`http://[${e}]`) : !1;
}
const ew = /* @__PURE__ */ ae("$ZodIPv6", (e, t) => {
  t.pattern ?? (t.pattern = t_), wt.init(e, t), e._zod.check = (r) => {
    hv(r.value) || r.issues.push({
      code: "invalid_format",
      format: "ipv6",
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), tw = /* @__PURE__ */ ae("$ZodCIDRv4", (e, t) => {
  t.pattern ?? (t.pattern = r_), wt.init(e, t);
});
function rw(e) {
  const t = e.split("/");
  if (t.length !== 2)
    return !1;
  const [r, n] = t;
  if (!n)
    return !1;
  const o = Number(n);
  return `${o}` !== n || o < 0 || o > 128 ? !1 : hv(r);
}
const nw = /* @__PURE__ */ ae("$ZodCIDRv6", (e, t) => {
  t.pattern ?? (t.pattern = n_), wt.init(e, t), e._zod.check = (r) => {
    rw(r.value) || r.issues.push({
      code: "invalid_format",
      format: "cidrv6",
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
});
function pv(e) {
  if (e === "")
    return !0;
  if (/\s/.test(e) || e.length % 4 !== 0)
    return !1;
  try {
    return atob(e), !0;
  } catch {
    return !1;
  }
}
const vv = /^[0-9a-zA-Z+/]*={0,2}$/, ow = /* @__PURE__ */ ae("$ZodBase64", (e, t) => {
  t.pattern ?? (t.pattern = vv), wt.init(e, t), e._zod.check = (r) => {
    pv(r.value) || r.issues.push({
      code: "invalid_format",
      format: "base64",
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Jc = /^[A-Za-z0-9_-]*$/;
function sw(e) {
  if (!Jc.test(e))
    return !1;
  const t = e.replace(/[-_]/g, (n) => n === "-" ? "+" : "/"), r = t.padEnd(Math.ceil(t.length / 4) * 4, "=");
  return pv(r);
}
const iw = /* @__PURE__ */ ae("$ZodBase64URL", (e, t) => {
  t.pattern ?? (t.pattern = Jc), wt.init(e, t), e._zod.check = (r) => {
    sw(r.value) || r.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), aw = /* @__PURE__ */ ae("$ZodE164", (e, t) => {
  t.pattern ?? (t.pattern = a_), wt.init(e, t);
});
function lw(e, t = null) {
  try {
    const r = e.split(".");
    if (r.length !== 3)
      return !1;
    const [n] = r;
    if (!n)
      return !1;
    const o = JSON.parse(atob(n));
    return !("typ" in o && o?.typ !== "JWT" || !o.alg || t && (!("alg" in o) || o.alg !== t));
  } catch {
    return !1;
  }
}
const cw = /* @__PURE__ */ ae("$ZodJWT", (e, t) => {
  wt.init(e, t), e._zod.check = (r) => {
    lw(r.value, t.alg) || r.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), gv = /* @__PURE__ */ ae("$ZodNumber", (e, t) => {
  St.init(e, t), e._zod.pattern = Kc, e._zod.parse = (r, n) => {
    if (t.coerce)
      try {
        r.value = Number(r.value);
      } catch {
      }
    const o = r.value;
    if (typeof o == "number" && !Number.isNaN(o) && Number.isFinite(o))
      return r;
    const s = typeof o == "number" ? Number.isNaN(o) ? "NaN" : Number.isFinite(o) ? void 0 : String(o) : void 0;
    return r.issues.push({
      expected: "number",
      code: "invalid_type",
      input: o,
      inst: e,
      ...s ? { received: s } : {}
    }), r;
  };
}), uw = /* @__PURE__ */ ae("$ZodNumberFormat", (e, t) => {
  b_.init(e, t), gv.init(e, t);
}), dw = /* @__PURE__ */ ae("$ZodBoolean", (e, t) => {
  St.init(e, t), e._zod.pattern = p_, e._zod.parse = (r, n) => {
    if (t.coerce)
      try {
        r.value = !!r.value;
      } catch {
      }
    const o = r.value;
    return typeof o == "boolean" || r.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input: o,
      inst: e
    }), r;
  };
}), fw = /* @__PURE__ */ ae("$ZodUnknown", (e, t) => {
  St.init(e, t), e._zod.parse = (r) => r;
}), hw = /* @__PURE__ */ ae("$ZodNever", (e, t) => {
  St.init(e, t), e._zod.parse = (r, n) => (r.issues.push({
    expected: "never",
    code: "invalid_type",
    input: r.value,
    inst: e
  }), r);
});
function Pd(e, t, r) {
  e.issues.length && t.issues.push(...To(r, e.issues)), t.value[r] = e.value;
}
const pw = /* @__PURE__ */ ae("$ZodArray", (e, t) => {
  St.init(e, t);
  const r = Vr.memoizer;
  r?.attach(e), e._zod.parse = (n, o) => {
    const s = n.value;
    if (!Array.isArray(s))
      return n.issues.push({
        expected: "array",
        code: "invalid_type",
        input: s,
        inst: e
      }), n;
    n.value = r ? r.alloc(e, n, Array(s.length), o) : Array(s.length);
    const i = [], l = o?.abortEarly;
    for (let c = 0; c < s.length; c++) {
      const u = s[c], d = t.element._zod.run({
        value: u,
        issues: []
      }, o);
      if (d instanceof Promise)
        i.push(d.then((f) => Pd(f, n, c)));
      else if (Pd(d, n, c), l && d.issues.length !== 0 && vn(d))
        break;
    }
    return i.length ? Promise.all(i).then(() => n) : n;
  };
});
function ra(e, t, r, n, o, s) {
  const i = r in n, l = s === "optional";
  if (!(!i && l && o === "optional")) {
    if (e.issues.length) {
      if (o !== void 0 && l && !i)
        return;
      t.issues.push(...To(r, e.issues));
    }
    if (!i && o === void 0) {
      e.issues.length || t.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [r]
      });
      return;
    }
    e.value === void 0 ? (i || o === "defaulted" && !l) && (t.value[r] = void 0) : t.value[r] = e.value;
  }
}
const vw = [];
function mv(e) {
  const t = Object.keys(e.shape), r = Object.getOwnPropertySymbols(e.shape), n = r.length ? r : vw, o = n.length ? [...t, ...n] : t;
  for (const i of o)
    if (!e.shape?.[i]?._zod?.traits?.has("$ZodType"))
      throw new Error(`Invalid element at key "${String(i)}": expected a Zod schema`);
  const s = ry(e.shape);
  return {
    ...e,
    allKeys: o,
    symbolKeys: n,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(t),
    numKeys: t.length,
    optionalKeys: new Set(s)
  };
}
function bv(e, t, r, n, o, s, i) {
  const l = [], c = o.keySet, u = o.catchall._zod, d = u.def.type, f = u.optin, h = u.optout;
  let p = 0;
  for (const v in t) {
    if (i && r.issues.length !== p) {
      if (vn(r, p))
        break;
      p = r.issues.length;
    }
    if (c.has(v))
      continue;
    if (v === "__proto__") {
      d === "never" && l.push(v);
      continue;
    }
    if (d === "never") {
      l.push(v);
      continue;
    }
    const g = u.run({ value: t[v], issues: [] }, n);
    g instanceof Promise ? e.push(g.then((y) => ra(y, r, v, t, f, h))) : ra(g, r, v, t, f, h);
  }
  return l.length && r.issues.push({
    code: "unrecognized_keys",
    keys: l,
    input: t,
    inst: s,
    // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
    continue: !0
  }), e.length ? Promise.all(e).then(() => r) : r;
}
const gw = /* @__PURE__ */ ae("$ZodObject", (e, t) => {
  St.init(e, t);
  const r = Object.getOwnPropertyDescriptor(t, "shape"), n = r?.get ? r.get.raw : t.shape ?? {};
  if (n) {
    const u = () => {
      const d = { ...n };
      return Object.defineProperty(t, "shape", { value: d }), u.raw = d, d;
    };
    u.raw = n, Object.defineProperty(t, "shape", { get: u });
  }
  const o = wa(() => mv(t));
  pt(e, "propValues", (u) => {
    const d = u.def.shape, f = {};
    for (const h in d) {
      const p = d[h]._zod;
      if (p.values) {
        Object.prototype.hasOwnProperty.call(f, h) || zn(f, h, /* @__PURE__ */ new Set());
        for (const v of p.values)
          f[h].add(v);
        p.optin !== void 0 && f[h].add(void 0);
      }
    }
    return f;
  });
  const s = Ns, i = t.catchall;
  let l;
  const c = Vr.memoizer;
  c?.attach(e), e._zod.parse = (u, d) => {
    l ?? (l = o.value);
    const f = u.value;
    if (!s(f))
      return u.issues.push({
        expected: "object",
        code: "invalid_type",
        input: f,
        inst: e
      }), u;
    u.value = c ? c.alloc(e, u, {}, d) : {};
    const h = [], p = l.shape, v = d?.abortEarly;
    let g = u.issues.length;
    for (const y of l.allKeys) {
      if (v && u.issues.length !== g) {
        if (vn(u, g))
          break;
        g = u.issues.length;
      }
      if (y === "__proto__")
        continue;
      const _ = p[y], k = _._zod.optin, S = _._zod.optout, b = _._zod.run({ value: f[y], issues: [] }, d);
      b instanceof Promise ? h.push(b.then(($) => ra($, u, y, f, k, S))) : ra(b, u, y, f, k, S);
    }
    return i ? bv(h, f, u, d, o.value, e, v === !0) : h.length ? Promise.all(h).then(() => u) : u;
  };
}), mw = /* @__PURE__ */ ae("$ZodObjectJIT", (e, t) => {
  gw.init(e, t);
  const r = e._zod.parse, n = wa(() => mv(t)), o = Vr.memoizer, s = (p) => {
    const v = n.value, g = v.symbolKeys, y = new M_(["payload", "ctx"], { shape: p, inst: e, memo: o, syms: g }), _ = ($) => `shape[${$}]._zod.run({ value: input[${$}], issues: [] }, ctx)`, k = ($, E) => `
          let ${$}_ab = false;
          for (let i = 0; i < ${$}.issues.length; i++) {
            const iss = ${$}.issues[i];
            iss.path = iss.path ? [${E}, ...iss.path] : [${E}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${$}_ab = true;
          }
          if (${$}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    y.write("const input = payload.value;");
    const S = /* @__PURE__ */ Object.create(null);
    let b = 0;
    for (const $ of v.allKeys)
      S[$] = `key_${b++}`;
    y.write(o ? "const newResult = memo.alloc(inst, payload, {}, ctx);" : "const newResult = {};");
    for (const $ of v.allKeys) {
      if ($ === "__proto__")
        continue;
      const E = S[$], C = typeof $ == "symbol" ? `syms[${g.indexOf($)}]` : Jx($), w = `${C} in input`, O = p[$], A = O?._zod?.optin, R = A !== void 0, W = O?._zod?.optout === "optional";
      if (y.write(`const ${E} = ${_(C)};`), R && W) {
        const q = A === "optional" ? `${E}_present` : `${E}.value !== undefined || ${E}_present`;
        y.write(`
        const ${E}_present = ${w};
        if (!${E}.issues.length || ${E}_present) {
          if (${E}.issues.length) {${k(E, C)}
          }

          if (${q}) {
            newResult[${C}] = ${E}.value;
          }
        }

      `);
      } else R ? (y.write(`
        if (${E}.issues.length) {${k(E, C)}
        }
      `), A === "defaulted" ? y.write(`newResult[${C}] = ${E}.value;`) : y.write(`
        if (${E}.value !== undefined || ${w}) {
          newResult[${C}] = ${E}.value;
        }
      `)) : y.write(`
        const ${E}_present = ${w};
        if (${E}.issues.length) {${k(E, C)}
        }
        if (!${E}_present && !${E}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${C}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${E}_present) {
          newResult[${C}] = ${E}.value;
        }

      `);
    }
    return y.write("payload.value = newResult;"), y.write("return payload;"), y.compile();
  };
  let i;
  const l = Ns, c = !Vr.jitless, d = c && ey.value, f = t.catchall;
  let h;
  e._zod.parse = (p, v) => {
    h ?? (h = n.value);
    const g = p.value;
    return l(g) ? c && d && v?.async === !1 && v.jitless !== !0 ? (i || (i = s(t.shape)), p = i(p, v), f ? bv([], g, p, v, h, e, v?.abortEarly === !0) : p) : r(p, v) : (p.issues.push({
      expected: "object",
      code: "invalid_type",
      input: g,
      inst: e
    }), p);
  };
});
function Id(e, t, r, n) {
  for (const s of e)
    if (s.issues.length === 0)
      return t.value = s.value, t;
  const o = e.filter((s) => !vn(s));
  return o.length === 1 ? (t.value = o[0].value, o[0]) : (t.issues.push({
    code: "invalid_union",
    input: t.value,
    inst: r,
    errors: e.map((s) => s.issues.map((i) => Wn(i, n, sn())))
  }), t);
}
const xv = /* @__PURE__ */ ae("$ZodUnion", (e, t) => {
  St.init(e, t), pt(e, "optin", (n) => n.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : n.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0), pt(e, "optout", (n) => n.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0), pt(e, "values", (n) => {
    if (n.def.options.every((o) => o._zod.values))
      return new Set(n.def.options.flatMap((o) => Array.from(o._zod.values)));
  }), pt(e, "pattern", (n) => {
    if (n.def.options.every((o) => o._zod.pattern)) {
      const o = n.def.options.map((s) => s._zod.pattern);
      return new RegExp(`^(${o.map((s) => Fc(s.source)).join("|")})$`);
    }
  });
  const r = t.options.length === 1 ? t.options[0]._zod.run : null;
  e._zod.parse = (n, o) => {
    if (r)
      return r(n, o);
    let s = !1;
    const i = [];
    for (const l of t.options) {
      const c = l._zod.run({
        value: n.value,
        issues: []
      }, o);
      if (c instanceof Promise)
        i.push(c), s = !0;
      else {
        if (c.issues.length === 0)
          return c;
        i.push(c);
      }
    }
    return s ? Promise.all(i).then((l) => Id(l, n, e, o)) : Id(i, n, e, o);
  };
});
function bw(e) {
  const t = /* @__PURE__ */ new Map();
  for (const r of e.options) {
    const n = r._zod.propValues?.[e.discriminator];
    if (!n || n.size === 0)
      throw new Error(`Invalid discriminated union option at index "${e.options.indexOf(r)}"`);
    for (const o of n)
      if (t.has(o)) {
        if (o !== void 0)
          throw new Error(`Duplicate discriminator value "${String(o)}"`);
        t.set(o, null);
      } else
        t.set(o, r);
  }
  return t;
}
const xw = /* @__PURE__ */ ae("$ZodDiscriminatedUnion", (e, t) => {
  t.inclusive = !1, xv.init(e, t);
  const r = e._zod.parse;
  pt(e, "propValues", (o) => {
    const s = {};
    let i = 0;
    for (const l of o.def.options) {
      const c = l._zod.propValues;
      if (!c || Object.keys(c).length === 0)
        throw new Error(`Invalid discriminated union option at index "${o.def.options.indexOf(l)}"`);
      c[o.def.discriminator]?.has(void 0) && i++;
      for (const [u, d] of Object.entries(c)) {
        Object.prototype.hasOwnProperty.call(s, u) || zn(s, u, /* @__PURE__ */ new Set());
        for (const f of d)
          s[u].add(f);
      }
    }
    return !o.def.unionFallback && i > 1 && s[o.def.discriminator]?.delete(void 0), s;
  }), t.options.forEach((o, s) => {
    const i = Zc(o._zod.def);
    if (i && !Object.prototype.hasOwnProperty.call(i, t.discriminator))
      throw new Error(`Invalid discriminated union option at index "${s}"`);
  });
  const n = wa(() => bw(t));
  e._zod.parse = (o, s) => {
    const i = o.value;
    if (!Ns(i))
      return o.issues.push({
        code: "invalid_type",
        expected: "object",
        input: i,
        inst: e
      }), o;
    const l = i?.[t.discriminator], c = n.value.get(l);
    return c && (l !== void 0 || s.direction !== "backward") ? c._zod.run(o, s) : t.unionFallback || s.direction === "backward" ? r(o, s) : (o.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: t.discriminator,
      options: Array.from(n.value.keys()).filter((u) => n.value.get(u) !== null),
      input: i,
      path: [t.discriminator],
      inst: e
    }), o);
  };
}), yw = /* @__PURE__ */ ae("$ZodIntersection", (e, t) => {
  St.init(e, t), e._zod.parse = (r, n) => {
    const o = r.value, s = t.left._zod.run({ value: o, issues: [] }, n), i = t.right._zod.run({ value: o, issues: [] }, n);
    return s instanceof Promise || i instanceof Promise ? Promise.all([s, i]).then(([c, u]) => Rd(r, c, u)) : Rd(r, s, i);
  };
});
function jl(e, t) {
  if (e === t)
    return { valid: !0, data: e };
  if (e instanceof Date && t instanceof Date && +e == +t)
    return { valid: !0, data: e };
  if (Bo(e) && Bo(t)) {
    const r = Object.keys(t), n = Object.keys(e).filter((s) => r.indexOf(s) !== -1), o = { ...e, ...t };
    Object.prototype.hasOwnProperty.call(o, "__proto__") && delete o.__proto__;
    for (const s of n) {
      if (s === "__proto__")
        continue;
      const i = jl(e[s], t[s]);
      if (!i.valid)
        return {
          valid: !1,
          mergeErrorPath: [s, ...i.mergeErrorPath]
        };
      o[s] = i.data;
    }
    return { valid: !0, data: o };
  }
  if (Array.isArray(e) && Array.isArray(t)) {
    if (e.length !== t.length)
      return { valid: !1, mergeErrorPath: [] };
    const r = [];
    for (let n = 0; n < e.length; n++) {
      const o = e[n], s = t[n], i = jl(o, s);
      if (!i.valid)
        return {
          valid: !1,
          mergeErrorPath: [n, ...i.mergeErrorPath]
        };
      r.push(i.data);
    }
    return { valid: !0, data: r };
  }
  return { valid: !1, mergeErrorPath: [] };
}
function Rd(e, t, r) {
  const n = /* @__PURE__ */ new Map();
  let o;
  const s = /* @__PURE__ */ new Map(), i = (u, d) => {
    let f;
    if (u.code === "unrecognized_keys" && !u.path?.length)
      o ?? (o = u), f = u.keys;
    else if (u.code === "invalid_key" && u.origin === "record" && u.path?.length === 1) {
      const h = String(u.path[0]);
      s.has(h) || s.set(h, u), f = [h];
    } else
      return !1;
    for (const h of f)
      n.has(h) || n.set(h, {}), n.get(h)[d] = !0;
    return !0;
  };
  for (const u of t.issues)
    i(u, "l") || e.issues.push(u);
  for (const u of r.issues)
    i(u, "r") || e.issues.push(u);
  const l = [...n].filter(([, u]) => u.l && u.r).map(([u]) => u);
  if (l.length) {
    const u = o ? l.filter((d) => o.keys.includes(d)) : [];
    u.length && e.issues.push({ ...o, keys: u });
    for (const d of l)
      !u.includes(d) && s.has(d) && e.issues.push(s.get(d));
  }
  const c = jl(t.value, r.value);
  if (!c.valid) {
    if (vn(e))
      return e;
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`);
  }
  return e.value = c.data, e;
}
const _w = /* @__PURE__ */ ae("$ZodRecord", (e, t) => {
  St.init(e, t);
  const r = Vr.memoizer;
  r?.attach(e), e._zod.parse = (n, o) => {
    const s = n.value;
    if (!Bo(s))
      return n.issues.push({
        expected: "record",
        code: "invalid_type",
        input: s,
        inst: e
      }), n;
    const i = [], l = t.keyType._zod.values;
    if (l && !t.partial) {
      n.value = r ? r.alloc(e, n, {}, o) : {};
      const c = /* @__PURE__ */ new Set();
      for (const d of l)
        if (typeof d == "string" || typeof d == "number" || typeof d == "symbol") {
          if (c.add(typeof d == "number" ? d.toString() : d), d === "__proto__")
            continue;
          const f = t.keyType._zod.run({ value: d, issues: [] }, o);
          if (f instanceof Promise)
            throw new Error("Async schemas not supported in object keys currently");
          if (f.issues.length) {
            n.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: f.issues.map((v) => Wn(v, o, sn())),
              input: d,
              path: [d],
              inst: e
            });
            continue;
          }
          const h = f.value;
          if (h === "__proto__")
            continue;
          const p = t.valueType._zod.run({ value: s[d], issues: [] }, o);
          p instanceof Promise ? i.push(p.then((v) => {
            v.issues.length && n.issues.push(...To(d, v.issues)), n.value[h] = v.value;
          })) : (p.issues.length && n.issues.push(...To(d, p.issues)), n.value[h] = p.value);
        }
      let u;
      for (const d in s)
        if (!c.has(d))
          if (t.mode === "loose") {
            if (d === "__proto__")
              continue;
            n.value[d] = s[d];
          } else
            u = u ?? [], u.push(d);
      u && u.length > 0 && n.issues.push({
        code: "unrecognized_keys",
        input: s,
        inst: e,
        keys: u,
        continue: !0
      });
    } else {
      n.value = r ? r.alloc(e, n, {}, o) : {};
      let c;
      for (const u of Reflect.ownKeys(s)) {
        if (u === "__proto__" || !Object.prototype.propertyIsEnumerable.call(s, u))
          continue;
        let d = t.keyType._zod.run({ value: u, issues: [] }, o);
        if (d instanceof Promise)
          throw new Error("Async schemas not supported in object keys currently");
        if (typeof u == "string" && Kc.test(u) && d.issues.length) {
          const v = t.keyType._zod.run({ value: Number(u), issues: [] }, o);
          if (v instanceof Promise)
            throw new Error("Async schemas not supported in object keys currently");
          v.issues.length === 0 && (d = v);
        }
        if (d.issues.length) {
          t.mode === "loose" ? n.value[u] = s[u] : l ? (c = c ?? [], c.push(u)) : n.issues.push({
            code: "invalid_key",
            origin: "record",
            issues: d.issues.map((v) => Wn(v, o, sn())),
            input: u,
            path: [u],
            inst: e
          });
          continue;
        }
        const h = d.value;
        if (h === "__proto__")
          continue;
        const p = t.valueType._zod.run({ value: s[u], issues: [] }, o);
        p instanceof Promise ? i.push(p.then((v) => {
          v.issues.length && n.issues.push(...To(u, v.issues)), n.value[h] = v.value;
        })) : (p.issues.length && n.issues.push(...To(u, p.issues)), n.value[h] = p.value);
      }
      c && c.length > 0 && n.issues.push({
        code: "unrecognized_keys",
        input: s,
        inst: e,
        keys: c,
        continue: !0
      });
    }
    return i.length ? Promise.all(i).then(() => n) : n;
  };
}), ww = /* @__PURE__ */ ae("$ZodEnum", (e, t) => {
  St.init(e, t);
  const r = Rl(t.entries), n = new Set(r);
  e._zod.values = n, pt(e, "pattern", (o) => {
    const s = Rl(o.def.entries).filter((i) => ty.has(typeof i));
    return new RegExp(s.length ? `^(${s.map((i) => Wo(i.toString())).join("|")})$` : "^[^\\s\\S]$");
  }), e._zod.parse = (o, s) => {
    const i = o.value;
    return n.has(i) || o.issues.push({
      code: "invalid_value",
      values: r,
      input: i,
      inst: e
    }), o;
  };
}), kw = /* @__PURE__ */ ae("$ZodLiteral", (e, t) => {
  St.init(e, t);
  const r = new Set(t.values);
  e._zod.values = r, pt(e, "pattern", (n) => {
    const o = n.def.values;
    return new RegExp(o.length ? `^(${o.map((s) => typeof s == "string" ? Wo(s) : s ? Wo(s.toString()) : String(s)).join("|")})$` : "^[^\\s\\S]$");
  }), e._zod.parse = (n, o) => {
    const s = n.value;
    return r.has(s) || n.issues.push({
      code: "invalid_value",
      values: t.values,
      input: s,
      inst: e
    }), n;
  };
}), Sw = /* @__PURE__ */ ae("$ZodTransform", (e, t) => {
  St.init(e, t), e._zod.optin = "optional", Vr.memoizer?.guard(e), e._zod.parse = (r, n) => {
    if (n.direction === "backward")
      throw new ov(e.constructor.name);
    const o = t.transform(r.value, r);
    if (n.async)
      return (o instanceof Promise ? o : Promise.resolve(o)).then((i) => (r.value = i, r));
    if (o instanceof Promise)
      throw new po();
    return r.value = o, r;
  };
});
function Dd(e, t) {
  return e.value = t.issues.length ? void 0 : t.value, e;
}
const yv = /* @__PURE__ */ ae("$ZodOptional", (e, t) => {
  St.init(e, t), pt(e, "optin", (r) => r.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), e._zod.optout = "optional", pt(e, "values", (r) => {
    const n = r.def.innerType._zod.values;
    return n ? /* @__PURE__ */ new Set([...n, void 0]) : void 0;
  }), pt(e, "pattern", (r) => {
    const n = r.def.innerType._zod.pattern;
    return n ? new RegExp(`^(${Fc(n.source)})?$`) : void 0;
  }), e._zod.parse = (r, n) => {
    if (r.value === void 0) {
      if (t.innerType._zod.optin !== "defaulted")
        return r;
      const o = t.innerType._zod.run({ value: r.value, issues: [] }, n);
      return o instanceof Promise ? o.then((s) => Dd(r, s)) : Dd(r, o);
    }
    return t.innerType._zod.run(r, n);
  };
}), $w = /* @__PURE__ */ ae("$ZodExactOptional", (e, t) => {
  yv.init(e, t), pt(e, "values", (r) => r.def.innerType._zod.values), pt(e, "pattern", (r) => r.def.innerType._zod.pattern), e._zod.parse = (r, n) => t.innerType._zod.run(r, n);
}), zw = /* @__PURE__ */ ae("$ZodNullable", (e, t) => {
  St.init(e, t), pt(e, "optin", (r) => r.def.innerType._zod.optin), pt(e, "optout", (r) => r.def.innerType._zod.optout), pt(e, "pattern", (r) => {
    const n = r.def.innerType._zod.pattern;
    return n ? new RegExp(`^(${Fc(n.source)}|null)$`) : void 0;
  }), pt(e, "values", (r) => r.def.innerType._zod.values ? /* @__PURE__ */ new Set([...r.def.innerType._zod.values, null]) : void 0), e._zod.parse = (r, n) => r.value === null ? r : t.innerType._zod.run(r, n);
}), Aw = /* @__PURE__ */ ae("$ZodDefault", (e, t) => {
  St.init(e, t), e._zod.optin = "defaulted", pt(e, "values", (r) => r.def.innerType._zod.values), e._zod.parse = (r, n) => {
    if (n.direction === "backward")
      return t.innerType._zod.run(r, n);
    if (r.value === void 0)
      return r.value = t.defaultValue, r;
    const o = t.innerType._zod.run(r, n);
    return o instanceof Promise ? o.then((s) => Ld(s, t)) : Ld(o, t);
  };
});
function Ld(e, t) {
  return e.value === void 0 && (e.value = t.defaultValue), e;
}
const Ew = /* @__PURE__ */ ae("$ZodPrefault", (e, t) => {
  St.init(e, t), e._zod.optin = "defaulted", pt(e, "values", (r) => r.def.innerType._zod.values), e._zod.parse = (r, n) => (n.direction === "backward" || r.value === void 0 && (r.value = t.defaultValue), t.innerType._zod.run(r, n));
}), Mw = /* @__PURE__ */ ae("$ZodNonOptional", (e, t) => {
  St.init(e, t), pt(e, "values", (r) => {
    const n = r.def.innerType._zod.values;
    return n ? new Set([...n].filter((o) => o !== void 0)) : void 0;
  }), e._zod.parse = (r, n) => {
    const o = t.innerType._zod.run(r, n);
    return o instanceof Promise ? o.then((s) => jd(s, e)) : jd(o, e);
  };
});
function jd(e, t) {
  return !e.issues.length && e.value === void 0 && e.issues.push({
    code: "invalid_type",
    expected: "nonoptional",
    input: e.value,
    inst: t
  }), e;
}
function Vd(e, t, r, n) {
  return t.issues.length ? (e.value = r.catchValue({
    ...t,
    value: e.value,
    error: {
      issues: t.issues.map((o) => Wn(o, n, sn()))
    },
    input: e.value
  }), e) : (e.value = t.value, t.memo && (e.memo = !0), e);
}
const Tw = /* @__PURE__ */ ae("$ZodCatch", (e, t) => {
  St.init(e, t), pt(e, "optin", (r) => r.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional"), pt(e, "optout", (r) => r.def.innerType._zod.optout), pt(e, "values", (r) => r.def.innerType._zod.values), e._zod.parse = (r, n) => {
    if (n.direction === "backward")
      return t.innerType._zod.run(r, n);
    const o = t.innerType._zod.run({ value: r.value, issues: [] }, n);
    return o instanceof Promise ? o.then((s) => Vd(r, s, t, n)) : Vd(r, o, t, n);
  };
}), Cw = /* @__PURE__ */ ae("$ZodPipe", (e, t) => {
  St.init(e, t), pt(e, "values", (r) => r.def.in._zod.values), pt(e, "optin", (r) => r.def.in._zod.optin), pt(e, "optout", (r) => r.def.out._zod.optout), pt(e, "propValues", (r) => r.def.in._zod.propValues), e._zod.parse = (r, n) => {
    if (n.direction === "backward") {
      const s = t.out._zod.run(r, n);
      return s instanceof Promise ? s.then((i) => gi(i, t.in, n)) : gi(s, t.in, n);
    }
    const o = t.in._zod.run(r, n);
    return o instanceof Promise ? o.then((s) => gi(s, t.out, n)) : gi(o, t.out, n);
  };
});
function gi(e, t, r) {
  return e.issues.some((n) => n.code !== "unrecognized_keys") ? (e.aborted = !0, e) : t._zod.run({ value: e.value, issues: e.issues }, r);
}
const Ow = /* @__PURE__ */ ae("$ZodReadonly", (e, t) => {
  St.init(e, t), pt(e, "propValues", (r) => r.def.innerType._zod.propValues), pt(e, "values", (r) => r.def.innerType._zod.values), pt(e, "optin", (r) => r.def.innerType?._zod?.optin), pt(e, "optout", (r) => r.def.innerType?._zod?.optout), e._zod.parse = (r, n) => {
    if (n.direction === "backward")
      return t.innerType._zod.run(r, n);
    const o = t.innerType._zod.run(r, n);
    return o instanceof Promise ? o.then(Fd) : Fd(o);
  };
});
function Fd(e) {
  return e.memo || (e.value = Object.freeze(e.value)), e;
}
const Nw = /* @__PURE__ */ ae("$ZodCustom", (e, t) => {
  ir.init(e, t), St.init(e, t), e._zod.parse = (r, n) => r, e._zod.check = (r) => {
    const n = r.value, o = t.fn(n);
    if (o instanceof Promise)
      return o.then((s) => Zd(s, r, n, e));
    Zd(o, r, n, e);
  };
});
function Zd(e, t, r, n) {
  if (!e) {
    const o = {
      code: "custom",
      input: r,
      inst: n,
      // incorporates params.error into issue reporting
      path: [...n._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !n._zod.def.abort
      // params: inst._zod.def.params,
    };
    n._zod.def.params && (o.params = n._zod.def.params), t.issues.push(Ps(o));
  }
}
class Pw extends Error {
  constructor() {
    super("Cannot parse a reference cycle that closes through a transform"), this.name = "ZodCyclicError";
  }
}
const Vl = "~memo", Ud = [];
function _v(e) {
  return e !== null && typeof e == "object";
}
function nl(e) {
  return e.map((t) => t.path ? { ...t, path: t.path.slice() } : { ...t });
}
const wv = /* @__PURE__ */ new WeakMap(), bs = 0, Di = 1, As = 2;
function Li(e, t, r) {
  const n = wv.get(e);
  if (n !== void 0)
    return n ? As : bs;
  if (t.has(e))
    return As;
  t.add(e);
  let o = bs;
  const s = (d) => {
    if (o !== As && d?._zod) {
      const f = Li(d, t);
      f > o && (o = f);
    }
  }, i = (d, f) => {
    let h = bs;
    for (const p of Reflect.ownKeys(d)) {
      const v = Object.getOwnPropertyDescriptor(d, p);
      if (!v.enumerable)
        continue;
      const g = v.get ? Di : v.value?._zod ? Li(v.value, t) : bs;
      g > h && (h = g);
    }
    return h;
  }, l = (d) => {
    d > o && (o = d);
  }, c = e._zod.def;
  switch (c.type) {
    case "object": {
      const d = Zc(c);
      l(d ? i(d) : Di), s(c.catchall);
      break;
    }
    case "array":
      s(c.element);
      break;
    case "tuple":
      for (const d of c.items)
        s(d);
      s(c.rest);
      break;
    case "record":
    case "map":
      s(c.keyType), s(c.valueType);
      break;
    case "set":
      s(c.valueType);
      break;
    case "union":
      for (const d of c.options)
        s(d);
      break;
    case "intersection":
      s(c.left), s(c.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      s(c.innerType);
      break;
    case "pipe":
      s(c.in), s(c.out);
      break;
    case "function":
      s(c.input), s(c.output);
      break;
    // `$ZodLazy` caches its inner on the def, so a resolved edge is followed exactly
    case "lazy": {
      const d = c._cachedInner ?? void 0;
      l(d ? Li(d, t) : Di);
      break;
    }
    // a leaf by choice: `parts` are regex fragments, not data positions
    case "template_literal":
    // leaves
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default:
      for (const d in c) {
        const f = Object.getOwnPropertyDescriptor(c, d);
        if (!f || f.get)
          continue;
        const h = f.value;
        if (!(!h || typeof h != "object")) {
          if (h._zod)
            s(h);
          else if (Array.isArray(h))
            for (const p of h)
              s(p);
        }
      }
  }
  return t.delete(e), Iw(e, o);
}
function Iw(e, t) {
  return t !== Di && wv.set(e, t === As), t;
}
function Rw(e, t) {
  let r = e.buckets.get(t);
  return r || (r = /* @__PURE__ */ new WeakMap(), e.buckets.set(t, r)), r;
}
let mi;
const bi = [], Dw = {
  alloc(e, t, r) {
    const n = mi;
    if (!n)
      return r;
    mi = void 0;
    const o = { value: r, issues: null };
    return n.set(t.value, o), bi.push(o), r;
  },
  guard(e) {
    var t;
    (t = e._zod).deferred ?? (t.deferred = []), e._zod.deferred.push(() => {
      const r = e._zod.parse, n = (o, s) => {
        if (s.direction !== "backward" && jw(s, o.value))
          throw new Pw();
        return r(o, s);
      };
      e._zod.parse = n, e._zod.run === r && (e._zod.run = n);
    });
  },
  attach(e) {
    var t;
    let r, n = !1, o, s;
    (t = e._zod).deferred ?? (t.deferred = []), e._zod.deferred.push(() => {
      const i = e._zod.parse, l = (c, u) => {
        if (r === void 0) {
          const _ = Li(e, /* @__PURE__ */ new Set());
          if (_ === bs)
            return e._zod.parse = i, e._zod.run === l && (e._zod.run = i), i(c, u);
          _ === As || n ? r = !0 : n = !0;
        }
        const d = c.value;
        if (!_v(d))
          return i(c, u);
        let f = u[Vl];
        f || (f = { buckets: /* @__PURE__ */ new WeakMap(), backEdges: void 0 }, u[Vl] = f);
        let h;
        o === u ? h = s : (h = Rw(f, e), o = u, s = h);
        const p = h.get(d);
        if (p)
          return c.value = p.value, p.issues ? p.issues.length && c.issues.push(...nl(p.issues)) : (c.memo = !0, f.backEdges ?? (f.backEdges = /* @__PURE__ */ new WeakSet()), f.backEdges.add(p.value)), c;
        mi = h;
        const v = bi.length, g = i(c, u);
        mi = void 0;
        const y = bi.length > v ? bi.pop() : void 0;
        return g instanceof Promise ? g.then((_) => (y && (y.issues = _.issues.length ? nl(_.issues) : Ud), _)) : (y && (y.issues = g.issues.length ? nl(g.issues) : Ud), g);
      };
      e._zod.parse = l, e._zod.run === i && (e._zod.run = l);
    });
  }
};
function Lw() {
  return Dw;
}
function jw(e, t) {
  const r = e[Vl]?.backEdges;
  return r !== void 0 && _v(t) && r.has(t);
}
const Vw = () => {
  const e = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function t(s) {
    return e[s] ?? null;
  }
  const r = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  }, n = {
    // Compatibility: "nan" -> "NaN" for display
    nan: "NaN"
    // All other type names omitted - they fall back to raw values via ?? operator
  };
  function o(s, i) {
    return s === "number" && typeof i == "number" && !Number.isFinite(i) ? String(i) : n[s] ?? s;
  }
  return (s) => {
    switch (s.code) {
      case "invalid_type": {
        const i = o(s.expected), l = fy(s.input), c = o(l, s.input);
        return `Invalid input: expected ${i}, received ${c}`;
      }
      case "invalid_value":
        return s.values.length === 1 ? `Invalid input: expected ${Qp(s.values[0])}` : `Invalid option: expected one of ${zd(s.values, "|")}`;
      case "too_big": {
        const i = s.exact ? "exactly " : s.inclusive ? "<=" : "<", l = t(s.origin);
        return l ? `Too big: expected ${s.origin ?? "value"} to have ${i}${s.maximum.toString()} ${l.unit ?? "elements"}` : `Too big: expected ${s.origin ?? "value"} to be ${i}${s.maximum.toString()}`;
      }
      case "too_small": {
        const i = s.exact ? "exactly " : s.inclusive ? ">=" : ">", l = t(s.origin);
        return l ? `Too small: expected ${s.origin} to have ${i}${s.minimum.toString()} ${l.unit}` : `Too small: expected ${s.origin} to be ${i}${s.minimum.toString()}`;
      }
      case "invalid_format": {
        const i = s;
        return i.format === "starts_with" ? `Invalid string: must start with "${i.prefix}"` : i.format === "ends_with" ? `Invalid string: must end with "${i.suffix}"` : i.format === "includes" ? `Invalid string: must include "${i.includes}"` : i.format === "regex" ? `Invalid string: must match pattern ${i.pattern}` : `Invalid ${r[i.format] ?? s.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${s.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${s.keys.length > 1 ? "s" : ""}: ${zd(s.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${s.origin}`;
      case "invalid_union":
        return s.options && Array.isArray(s.options) && s.options.length > 0 ? `Invalid discriminator value. Expected ${s.options.map((l) => `'${l}'`).join(" | ")}` : s.inclusive === !1 ? "Invalid input: more than one option matched" : "Invalid input";
      case "invalid_element":
        return `Invalid value in ${s.origin}`;
      default:
        return "Invalid input";
    }
  };
};
function Fw() {
  return {
    localeError: Vw()
  };
}
var Bd;
class Zw {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
  }
  add(t, ...r) {
    const n = r[0];
    return this._map.set(t, n), n && typeof n == "object" && "id" in n && this._idmap.set(n.id, t), this;
  }
  clear() {
    return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
  }
  remove(t) {
    const r = this._map.get(t);
    return r && typeof r == "object" && "id" in r && this._idmap.delete(r.id), this._map.delete(t), this;
  }
  get(t) {
    const r = t._zod.parent;
    if (r) {
      const n = { ...this.get(r) ?? {} };
      delete n.id;
      const o = { ...n, ...this._map.get(t) };
      return Object.keys(o).length ? o : void 0;
    }
    return this._map.get(t);
  }
  has(t) {
    return this._map.has(t);
  }
}
function Uw() {
  return new Zw();
}
(Bd = globalThis).__zod_globalRegistry ?? (Bd.__zod_globalRegistry = Uw());
const xs = globalThis.__zod_globalRegistry;
function kv(e) {
  return e.checks && (e.checks = [...e.checks]), e;
}
// @__NO_SIDE_EFFECTS__
function Bw(e, t) {
  return new e(kv({ type: "string", ...Ue(t) }));
}
// @__NO_SIDE_EFFECTS__
function Ww(e, t) {
  return new e({
    type: "string",
    format: "email",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Hw(e, t) {
  return new e({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function qw(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Gw(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v4",
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Kw(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v6",
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Yw(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v7",
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Xw(e, t) {
  return new e({
    type: "string",
    format: "url",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Jw(e, t) {
  return new e({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Qw(e, t) {
  return new e({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function e2(e, t) {
  return new e({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function t2(e, t) {
  return new e({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function r2(e, t) {
  return new e({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function n2(e, t) {
  return new e({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function o2(e, t) {
  return new e({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function s2(e, t) {
  return new e({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function i2(e, t) {
  return new e({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function a2(e, t) {
  return new e({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function l2(e, t) {
  return new e({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function c2(e, t) {
  return new e({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function u2(e, t) {
  return new e({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function d2(e, t) {
  return new e({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function f2(e, t) {
  return new e({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: !1,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Sv(e, t) {
  return new e({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: !1,
    local: !1,
    precision: null,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function h2(e, t) {
  return new e({
    type: "string",
    format: "date",
    check: "string_format",
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function p2(e, t) {
  return new e({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function v2(e, t) {
  return new e({
    type: "string",
    format: "duration",
    check: "string_format",
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function g2(e, t) {
  return new e(kv({ type: "number", checks: [], ...Ue(t) }));
}
// @__NO_SIDE_EFFECTS__
function m2(e, t) {
  return new e({
    type: "number",
    check: "number_format",
    abort: !1,
    format: "safeint",
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function b2(e, t) {
  return new e({
    type: "boolean",
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function x2(e) {
  return new e({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function y2(e, t) {
  return new e({
    type: "never",
    ...Ue(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Wd(e, t) {
  return new av({
    check: "less_than",
    ...Ue(t),
    value: e,
    inclusive: !1
  });
}
// @__NO_SIDE_EFFECTS__
function ol(e, t) {
  return new av({
    check: "less_than",
    ...Ue(t),
    value: e,
    inclusive: !0
  });
}
// @__NO_SIDE_EFFECTS__
function Hd(e, t) {
  return new lv({
    check: "greater_than",
    ...Ue(t),
    value: e,
    inclusive: !1
  });
}
// @__NO_SIDE_EFFECTS__
function sl(e, t) {
  return new lv({
    check: "greater_than",
    ...Ue(t),
    value: e,
    inclusive: !0
  });
}
// @__NO_SIDE_EFFECTS__
function qd(e, t) {
  return new m_({
    check: "multiple_of",
    ...Ue(t),
    value: e
  });
}
// @__NO_SIDE_EFFECTS__
function $v(e, t) {
  return new x_({
    check: "max_length",
    ...Ue(t),
    maximum: e
  });
}
// @__NO_SIDE_EFFECTS__
function na(e, t) {
  return new y_({
    check: "min_length",
    ...Ue(t),
    minimum: e
  });
}
// @__NO_SIDE_EFFECTS__
function zv(e, t) {
  return new __({
    check: "length_equals",
    ...Ue(t),
    length: e
  });
}
// @__NO_SIDE_EFFECTS__
function _2(e, t) {
  return new w_({
    check: "string_format",
    format: "regex",
    ...Ue(t),
    pattern: e
  });
}
// @__NO_SIDE_EFFECTS__
function w2(e) {
  return new k_({
    check: "string_format",
    format: "lowercase",
    ...Ue(e)
  });
}
// @__NO_SIDE_EFFECTS__
function k2(e) {
  return new S_({
    check: "string_format",
    format: "uppercase",
    ...Ue(e)
  });
}
// @__NO_SIDE_EFFECTS__
function S2(e, t) {
  return new $_({
    check: "string_format",
    format: "includes",
    ...Ue(t),
    includes: e
  });
}
// @__NO_SIDE_EFFECTS__
function $2(e, t) {
  return new z_({
    check: "string_format",
    format: "starts_with",
    ...Ue(t),
    prefix: e
  });
}
// @__NO_SIDE_EFFECTS__
function z2(e, t) {
  return new A_({
    check: "string_format",
    format: "ends_with",
    ...Ue(t),
    suffix: e
  });
}
// @__NO_SIDE_EFFECTS__
function ss(e) {
  return new E_({
    check: "overwrite",
    tx: e
  });
}
// @__NO_SIDE_EFFECTS__
function A2(e) {
  return /* @__PURE__ */ ss((t) => t.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function E2() {
  return /* @__PURE__ */ ss((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function M2() {
  return /* @__PURE__ */ ss((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function T2() {
  return /* @__PURE__ */ ss((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function C2() {
  return /* @__PURE__ */ ss((e) => Qx(e));
}
// @__NO_SIDE_EFFECTS__
function O2(e, t, r) {
  return new e({
    type: "array",
    element: t,
    // get element() {
    //   return element;
    // },
    ...Ue(r)
  });
}
// @__NO_SIDE_EFFECTS__
function N2(e, t, r) {
  return new e({
    type: "custom",
    check: "custom",
    fn: t,
    ...Ue(r)
  });
}
// @__NO_SIDE_EFFECTS__
function P2(e, t) {
  const r = /* @__PURE__ */ I2((n) => (n.addIssue = (o) => {
    if (typeof o == "string")
      n.issues.push(Ps(o, n.value, r._zod.def));
    else {
      const s = o;
      s.fatal && (s.continue = !1), s.code ?? (s.code = "custom"), "input" in s || (s.input = n.value), s.inst ?? (s.inst = r), s.continue ?? (s.continue = !r._zod.def.abort), n.issues.push(Ps(s));
    }
  }, e(n.value, n)), t);
  return r;
}
// @__NO_SIDE_EFFECTS__
function I2(e, t) {
  const r = new ir({
    check: "custom",
    ...Ue(t)
  });
  return r._zod.check = e, r;
}
function Es(e, ...t) {
  for (const r of t)
    for (const n of Reflect.ownKeys(r))
      Object.prototype.propertyIsEnumerable.call(r, n) && zn(e, n, r[n]);
  return e;
}
function Av(e) {
  let t = e?.target ?? "draft-2020-12";
  return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
    processors: e.processors ?? {},
    metadataRegistry: e?.metadata ?? xs,
    target: t,
    unrepresentable: e?.unrepresentable ?? "throw",
    override: e?.override ?? (() => {
    }),
    io: e?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    sharedDefsExtractedFor: void 0,
    sharedEmitDoneFor: void 0,
    cycles: e?.cycles ?? "ref",
    reused: e?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: e?.external ?? void 0
  };
}
function qn(e, t, r, n, o) {
  const s = typeof t.unrepresentable == "function" ? t.unrepresentable({ zodSchema: e, path: n.path, message: o }) : t.unrepresentable;
  if (s === "any")
    return !1;
  if (s === void 0 || s === "throw")
    throw new Error(o);
  return Object.assign(r, s), !0;
}
function Ct(e, t, r = { path: [], schemaPath: [] }) {
  var n;
  const o = e._zod.def, s = t.seen.get(e);
  if (s)
    return s.count++, r.schemaPath.includes(e) && (s.cycle = r.path), s.schema;
  const i = { schema: {}, count: 1, cycle: void 0, path: r.path };
  t.seen.set(e, i), t.sharedDefsExtractedFor = void 0, t.sharedEmitDoneFor = void 0;
  const l = e._zod.toJSONSchema?.();
  if (l)
    i.schema = l;
  else {
    const d = {
      ...r,
      schemaPath: [...r.schemaPath, e],
      path: r.path
    };
    if (e._zod.processJSONSchema)
      e._zod.processJSONSchema(t, i.schema, d);
    else {
      const h = i.schema, p = t.processors[o.type];
      if (!p)
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${o.type}`);
      p(e, t, h, d);
    }
    const f = e._zod.parent;
    f && (i.ref || (i.ref = f), Ct(f, t, d), t.seen.get(f).isParent = !0);
  }
  const c = t.metadataRegistry.get(e);
  return c && Es(i.schema, c), t.io === "input" && Wt(e) && (delete i.schema.examples, delete i.schema.default), t.io === "input" && "_prefault" in i.schema && ((n = i.schema).default ?? (n.default = i.schema._prefault)), delete i.schema._prefault, t.seen.get(e).schema;
}
function Gd(e) {
  return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
function Ev(e, t) {
  const r = e.seen.get(t);
  if (!r)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (e.external && e.sharedDefsExtractedFor === e.external)
    return;
  const n = /* @__PURE__ */ new Map();
  for (const i of e.seen.entries()) {
    const l = e.metadataRegistry.get(i[0])?.id;
    if (l) {
      const c = n.get(l);
      if (c && c !== i[0])
        throw new Error(`Duplicate schema id "${l}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      n.set(l, i[0]);
    }
  }
  const o = (i) => {
    const l = e.target === "draft-2020-12" ? "$defs" : "definitions";
    if (e.external) {
      const f = e.external.registry.get(i[0])?.id, h = e.external.uri ?? ((v) => v);
      if (f)
        return { ref: h(f) };
      const p = i[1].defId ?? i[1].schema.id ?? `schema${e.counter++}`;
      return i[1].defId = p, { defId: p, ref: `${h("__shared")}#/${l}/${Gd(p)}` };
    }
    const c = "#", u = `${c}/${l}/`;
    if (i[1] === r && !i[1].schema.id)
      return { ref: c };
    const d = i[1].schema.id ?? `__schema${e.counter++}`;
    return { defId: d, ref: u + Gd(d) };
  }, s = (i) => {
    if (i[1].schema.$ref)
      return;
    const l = i[1], { ref: c, defId: u } = o(i);
    l.def = { ...l.schema }, u && (l.defId = u);
    const d = l.schema;
    for (const f in d)
      delete d[f];
    d.$ref = c;
  };
  if (e.cycles === "throw")
    for (const i of e.seen.entries()) {
      const l = i[1];
      if (l.cycle)
        throw new Error(`Cycle detected: #/${l.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
    }
  for (const i of e.seen.entries()) {
    const l = i[1];
    if (t === i[0]) {
      s(i);
      continue;
    }
    if (e.external) {
      const u = e.external.registry.get(i[0])?.id;
      if (t !== i[0] && u) {
        s(i);
        continue;
      }
    }
    if (e.metadataRegistry.get(i[0])?.id) {
      s(i);
      continue;
    }
    if (l.cycle) {
      s(i);
      continue;
    }
    l.count > 1 && e.reused === "ref" && s(i);
  }
  e.external && (e.sharedDefsExtractedFor = e.external);
}
function Mv(e) {
  const t = e.anyOf;
  if (!Array.isArray(t) || t.length === 0 || e.type !== void 0)
    return;
  const r = [];
  for (const n of t) {
    if (!n || typeof n != "object")
      return;
    Mv(n);
    const o = Object.keys(n);
    if (o.length !== 1 || o[0] !== "type")
      return;
    const s = n.type;
    for (const i of Array.isArray(s) ? s : [s]) {
      if (typeof i != "string")
        return;
      r.includes(i) || r.push(i);
    }
  }
  delete e.anyOf, e.type = r.length === 1 ? r[0] : r;
}
const Tv = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties"]), Kd = ["oneOf", "anyOf"];
function Yd(e) {
  const t = e.additionalProperties;
  return t === void 0 || t === !1 || typeof t != "object" || t === null ? null : Object.keys(t).length ? t : null;
}
function Fl(e) {
  const t = [];
  for (const s of e) {
    if (typeof s != "object" || s.type !== "object")
      return null;
    for (const i in s)
      if (!Tv.has(i))
        return null;
    t.push(s);
  }
  const r = {}, n = /* @__PURE__ */ new Set();
  for (const s of t) {
    for (const i in s.properties) {
      if (Object.prototype.hasOwnProperty.call(r, i))
        continue;
      const l = [];
      for (const u of t) {
        const d = u.properties?.[i] ?? Yd(u);
        d != null && (l.some((f) => JSON.stringify(f) === JSON.stringify(d)) || l.push(d));
      }
      const c = l.length === 1 ? l[0] : Fl(l) ?? { allOf: l };
      zn(r, i, c);
    }
    for (const i of s.required ?? [])
      n.add(i);
  }
  const o = { type: "object", properties: r };
  if (n.size && (o.required = [...n]), t.every((s) => s.additionalProperties === !1))
    o.additionalProperties = !1;
  else {
    const s = [];
    for (const i of t) {
      const l = Yd(i);
      l && !s.some((c) => JSON.stringify(c) === JSON.stringify(l)) && s.push(l);
    }
    s.length === 1 ? o.additionalProperties = s[0] : s.length > 1 && (o.additionalProperties = { allOf: s });
  }
  return o;
}
function R2(e) {
  const t = e.allOf;
  if (!Array.isArray(t) || t.length < 2)
    return;
  for (const o of Tv)
    if (o in e)
      return;
  const r = t.filter((o) => Kd.some((s) => Array.isArray(o[s])));
  let n = null;
  if (!r.length)
    n = Fl(t);
  else {
    const o = r[0], s = Kd.find((c) => Array.isArray(o[c]));
    if (Object.keys(o).length !== 1)
      return;
    const i = t.filter((c) => c !== o), l = o[s].map((c) => Fl([...i, c]));
    if (l.some((c) => !c))
      return;
    n = { [s]: l };
  }
  n && (delete e.allOf, Es(e, n));
}
function Cv(e, t) {
  const r = e.seen.get(t);
  if (!r)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const n = (l) => {
    const c = e.seen.get(l);
    if (c.ref === null)
      return;
    const u = c.def ?? c.schema, d = { ...u }, f = c.ref;
    if (c.ref = null, f) {
      n(f);
      const p = e.seen.get(f), v = p.schema;
      if (v.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (u.allOf = u.allOf ?? [], u.allOf.push(v)) : Es(u, v), Es(u, d), l._zod.parent === f)
        for (const y in u)
          y === "$ref" || y === "allOf" || y in d || delete u[y];
      if (v.$ref && p.def)
        for (const y in u)
          y === "$ref" || y === "allOf" || y in p.def && JSON.stringify(u[y]) === JSON.stringify(p.def[y]) && delete u[y];
    }
    const h = l._zod.parent;
    if (h && h !== f) {
      n(h);
      const p = e.seen.get(h);
      if (p?.schema.$ref && (u.$ref = p.schema.$ref, p.def))
        for (const v in u)
          v === "$ref" || v === "allOf" || v in p.def && JSON.stringify(u[v]) === JSON.stringify(p.def[v]) && delete u[v];
    }
    e.override({
      zodSchema: l,
      jsonSchema: u,
      path: c.path ?? []
    });
  };
  if (!e.external || e.sharedEmitDoneFor !== e.external) {
    for (const l of [...e.seen.entries()].reverse())
      n(l[0]);
    if (e.target !== "openapi-3.0")
      for (const l of e.seen.entries())
        Mv(l[1].def ?? l[1].schema);
    for (const l of e.deferred)
      l();
    if (e.intersections.length) {
      const l = /* @__PURE__ */ new Map();
      for (const c of e.seen.values())
        for (const u of [c.schema, c.def]) {
          const d = u?.allOf;
          if (!Array.isArray(d))
            continue;
          const f = l.get(d);
          f ? f.push(u) : l.set(d, [u]);
        }
      for (const c of e.intersections)
        for (const u of l.get(c) ?? [])
          R2(u);
    }
  }
  const o = {};
  if (e.target === "draft-2020-12" ? o.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? o.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? o.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
    const l = e.external.registry.get(t)?.id;
    if (!l)
      throw new Error("Schema is missing an `id` property");
    o.$id = e.external.uri(l);
  }
  Es(o, r.defId ? r.schema : r.def ?? r.schema);
  const s = e.metadataRegistry.get(t)?.id;
  s !== void 0 && o.id === s && delete o.id;
  const i = e.external?.defs ?? {};
  if (!e.external || e.sharedEmitDoneFor !== e.external)
    for (const l of e.seen.entries()) {
      const c = l[1];
      c.def && c.defId && (c.def.id === c.defId && delete c.def.id, zn(i, c.defId, c.def));
    }
  e.external && (e.sharedEmitDoneFor = e.external), e.external || Object.keys(i).length > 0 && (e.target === "draft-2020-12" ? o.$defs = i : o.definitions = i);
  try {
    const l = JSON.parse(JSON.stringify(o));
    return Object.defineProperty(l, "~standard", {
      value: {
        ...t["~standard"],
        jsonSchema: {
          input: oa(t, "input", e.processors),
          output: oa(t, "output", e.processors)
        }
      },
      enumerable: !1,
      writable: !1
    }), l;
  } catch {
    throw new Error("Error converting schema to JSON.");
  }
}
function Wt(e, t) {
  const r = t ?? { seen: /* @__PURE__ */ new Set() };
  if (r.seen.has(e))
    return !1;
  r.seen.add(e);
  const n = e._zod.def;
  if (n.type === "transform")
    return !0;
  if (n.type === "array")
    return Wt(n.element, r);
  if (n.type === "set")
    return Wt(n.valueType, r);
  if (n.type === "lazy")
    return Wt(n.getter(), r);
  if (n.type === "promise" || n.type === "optional" || n.type === "nonoptional" || n.type === "nullable" || n.type === "readonly" || n.type === "default" || n.type === "prefault" || n.type === "catch")
    return Wt(n.innerType, r);
  if (n.type === "intersection")
    return Wt(n.left, r) || Wt(n.right, r);
  if (n.type === "record" || n.type === "map")
    return Wt(n.keyType, r) || Wt(n.valueType, r);
  if (n.type === "pipe")
    return e._zod.traits.has("$ZodCodec") ? !0 : Wt(n.in, r) || Wt(n.out, r);
  if (n.type === "object") {
    for (const o in n.shape)
      if (Wt(n.shape[o], r))
        return !0;
    return !1;
  }
  if (n.type === "union") {
    for (const o of n.options)
      if (Wt(o, r))
        return !0;
    return !1;
  }
  if (n.type === "tuple") {
    for (const o of n.items)
      if (Wt(o, r))
        return !0;
    return !!(n.rest && Wt(n.rest, r));
  }
  return !1;
}
const D2 = (e, t = {}) => (r) => {
  const n = Av({ ...r, processors: t });
  return Ct(e, n), Ev(n, e), Cv(n, e);
}, oa = (e, t, r = {}) => (n) => {
  const { libraryOptions: o, target: s } = n ?? {}, i = Av({ ...o ?? {}, target: s, io: t, processors: r });
  return Ct(e, i), Ev(i, e), Cv(i, e);
}, Ho = (e, t, r) => {
  (e[t] === void 0 || r > e[t]) && (e[t] = r);
}, qo = (e, t, r) => {
  (e[t] === void 0 || r < e[t]) && (e[t] = r);
}, Xd = (e, t) => {
  Ho(e, "minimum", t), qo(e, "maximum", t);
}, Ov = (e, t) => {
  e.multipleOf ?? (e.multipleOf = []), e.multipleOf.includes(t) || e.multipleOf.push(t);
}, Nv = (e, t) => {
  e.patterns ?? (e.patterns = /* @__PURE__ */ new Set()), e.patterns.add(t);
}, Pv = (e, t) => {
  e.mime = e.mime ? e.mime.filter((r) => t.includes(r)) : [...t];
}, Iv = (e, t) => {
  e.format = t, t.includes("int") && (e.isInt = !0);
}, Jd = (e, t) => Ho(e, "minimum", t.minimum), Qd = (e, t) => qo(e, "maximum", t.maximum), ef = (e) => (t, r) => {
  Iv(t, r.format);
  const [n, o] = e[r.format];
  Ho(t, "minimum", n), qo(t, "maximum", o);
}, L2 = {
  greater_than: (e, t) => Ho(e, t.inclusive ? "minimum" : "exclusiveMinimum", t.value),
  less_than: (e, t) => qo(e, t.inclusive ? "maximum" : "exclusiveMaximum", t.value),
  multiple_of: (e, t) => Ov(e, t.value),
  number_format: ef(ev),
  bigint_format: ef(ny),
  min_length: Jd,
  max_length: Qd,
  length_equals: (e, t) => Xd(e, t.length),
  min_size: Jd,
  max_size: Qd,
  size_equals: (e, t) => Xd(e, t.size),
  string_format: (e, t) => {
    Iv(e, t.format), t.pattern && Nv(e, t.pattern), (t.format === "base64" || t.format === "base64url") && (e.contentEncoding = t.format), (t.local || t.precision === -1) && (e.laxFormat = !0);
  },
  mime_type: (e, t) => Pv(e, t.mime)
};
function Rr(e) {
  const t = {}, r = e._zod.def, n = e._zod.traits.has("$ZodCheck") ? [e, ...r.checks ?? []] : r.checks ?? [];
  for (const s of n)
    L2[s._zod.def.check]?.(t, s._zod.def);
  const o = e._zod.bag;
  o.minimum !== void 0 && Ho(t, "minimum", o.minimum), o.exclusiveMinimum !== void 0 && Ho(t, "exclusiveMinimum", o.exclusiveMinimum), o.maximum !== void 0 && qo(t, "maximum", o.maximum), o.exclusiveMaximum !== void 0 && qo(t, "exclusiveMaximum", o.exclusiveMaximum), o.multipleOf !== void 0 && Ov(t, o.multipleOf), o.format !== void 0 && (t.format ?? (t.format = o.format), o.format.includes("int") && (t.isInt = !0)), o.mime && Pv(t, o.mime);
  for (const s of o.patterns ?? [])
    Nv(t, s);
  return t;
}
const j2 = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
}, V2 = /* @__PURE__ */ new Map([
  [vv, o_],
  [Jc, s_]
]), Rv = (e) => V2.get(e) ?? e, F2 = (e, t, r, n) => {
  const o = r;
  o.type = "string";
  const { minimum: s, maximum: i, format: l, patterns: c, contentEncoding: u, laxFormat: d } = Rr(e);
  if (typeof s == "number" && (o.minLength = s), typeof i == "number" && (o.maxLength = i), l && (o.format = j2[l] ?? l, o.format === "" && delete o.format, (l === "time" || d) && delete o.format), u && (o.contentEncoding = u), c && c.size > 0) {
    const f = [...c].map(Rv);
    f.length === 1 ? o.pattern = f[0].source : f.length > 1 && (o.allOf = [
      ...f.map((h) => ({
        ...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
        pattern: h.source
      }))
    ]);
  }
}, Z2 = (e, t, r, n) => {
  const o = r, { minimum: s, maximum: i, multipleOf: l, exclusiveMaximum: c, exclusiveMinimum: u, isInt: d } = Rr(e);
  o.type = d ? "integer" : "number";
  const f = typeof u == "number" && u >= (s ?? Number.NEGATIVE_INFINITY), h = typeof c == "number" && c <= (i ?? Number.POSITIVE_INFINITY), p = t.target === "draft-04" || t.target === "openapi-3.0";
  if (f ? p ? (o.minimum = u, o.exclusiveMinimum = !0) : o.exclusiveMinimum = u : typeof s == "number" && (o.minimum = s), h ? p ? (o.maximum = c, o.exclusiveMaximum = !0) : o.exclusiveMaximum = c : typeof i == "number" && (o.maximum = i), l) {
    const v = /* @__PURE__ */ new Set();
    for (const _ of l)
      Number.isFinite(_) && _ !== 0 ? v.add(Math.abs(_)) : qn(e, t, o, n, `A multipleOf divisor of ${_} cannot be represented in JSON Schema`);
    const [g, ...y] = v;
    g !== void 0 && (o.multipleOf = g), y.length && (o.allOf = [...o.allOf ?? [], ...y.map((_) => ({ multipleOf: _ }))]);
  }
}, U2 = (e, t, r, n) => {
  r.type = "boolean";
}, B2 = (e, t, r, n) => {
  r.not = {};
}, W2 = (e, t, r, n) => {
}, H2 = (e, t, r, n) => {
  const o = e._zod.def, s = Rl(o.entries);
  if (s.length === 0) {
    r.not = {};
    return;
  }
  s.every((i) => typeof i == "number") && (r.type = "number"), s.every((i) => typeof i == "string") && (r.type = "string"), r.enum = s;
}, q2 = (e, t, r, n) => {
  const o = e._zod.def;
  if (o.values.length === 0) {
    r.not = {};
    return;
  }
  const s = [];
  for (const i of o.values)
    if (i === void 0) {
      if (qn(e, t, r, n, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof i == "bigint") {
      if (qn(e, t, r, n, "BigInt literals cannot be represented in JSON Schema"))
        return;
      s.push(Number(i));
    } else
      s.push(i);
  if (s.length !== 0) if (s.length === 1) {
    const i = s[0];
    r.type = i === null ? "null" : typeof i, t.target === "draft-04" || t.target === "openapi-3.0" ? r.enum = [i] : r.const = i;
  } else
    s.every((i) => typeof i == "number") && (r.type = "number"), s.every((i) => typeof i == "string") && (r.type = "string"), s.every((i) => typeof i == "boolean") && (r.type = "boolean"), s.every((i) => i === null) && (r.type = "null"), r.enum = s;
}, G2 = (e, t, r, n) => {
  qn(e, t, r, n, "Custom types cannot be represented in JSON Schema");
}, K2 = (e, t, r, n) => {
  qn(e, t, r, n, "Transforms cannot be represented in JSON Schema");
}, Y2 = (e, t, r, n) => {
  const o = r, s = e._zod.def, { minimum: i, maximum: l } = Rr(e);
  typeof i == "number" && (o.minItems = i), typeof l == "number" && (o.maxItems = l), o.type = "array", o.items = Ct(s.element, t, {
    ...n,
    path: [...n.path, "items"]
  });
};
function sa(e) {
  const t = e._zod.def;
  return t.type === "pipe" && t.in._zod.traits.has("$ZodTransform") ? sa(t.out) : t.type === "catch" ? sa(t.innerType) : e._zod.optin;
}
const X2 = (e, t, r, n) => {
  const o = r, s = e._zod.def, i = s.shape;
  if (Object.getOwnPropertySymbols(i).length && qn(e, t, o, n, "Symbol keys cannot be represented in JSON Schema"))
    return;
  o.type = "object", o.properties = {};
  for (const u in i)
    zn(o.properties, u, Ct(i[u], t, {
      ...n,
      path: [...n.path, "properties", u]
    }));
  const c = [];
  for (const u of Object.keys(i)) {
    const d = s.shape[u];
    (t.io === "input" ? sa(d) === void 0 : d._zod.optout === void 0) && c.push(u);
  }
  c.length > 0 && (o.required = c), s.catchall?._zod.def.type === "never" ? o.additionalProperties = !1 : s.catchall ? s.catchall && (o.additionalProperties = Ct(s.catchall, t, {
    ...n,
    path: [...n.path, "additionalProperties"]
  })) : t.io === "output" && (o.additionalProperties = !1);
}, J2 = (e, t, r, n) => {
  const o = e._zod.def, s = o.inclusive === !1, i = o.options.map((l, c) => Ct(l, t, {
    ...n,
    path: [...n.path, s ? "oneOf" : "anyOf", c]
  }));
  s ? r.oneOf = i : r.anyOf = i;
}, Q2 = (e, t, r, n) => {
  const o = e._zod.def, s = Ct(o.left, t, {
    ...n,
    path: [...n.path, "allOf", 0]
  }), i = Ct(o.right, t, {
    ...n,
    path: [...n.path, "allOf", 1]
  }), l = (u) => "allOf" in u && Object.keys(u).length === 1, c = [
    ...l(s) ? s.allOf : [s],
    ...l(i) ? i.allOf : [i]
  ];
  r.allOf = c, t.intersections.push(c);
};
function Zl(e, t, r) {
  if (t.$ref) {
    if (r.has(t))
      return t;
    r.add(t);
    const v = e.get(t)?.def;
    if (!v)
      return t;
    const g = Zl(e, v, r);
    return g === v ? t : g;
  }
  for (const v of ["anyOf", "oneOf"]) {
    const g = t[v];
    if (!Array.isArray(g))
      continue;
    const y = g.map((_) => Zl(e, _, r));
    y.some((_, k) => _ !== g[k]) && (t = { ...t, [v]: y });
  }
  const n = Array.isArray(t.type) ? t.type : [t.type], o = !n.includes("string") && n.some((v) => v === "number" || v === "integer"), s = t.enum ?? (t.const !== void 0 ? [t.const] : void 0);
  if (!o && !s?.some((v) => typeof v == "number"))
    return t;
  const { minimum: i, maximum: l, exclusiveMinimum: c, exclusiveMaximum: u, multipleOf: d, format: f, id: h, ...p } = t;
  return p.enum ? p.enum = p.enum.map((v) => typeof v == "number" ? String(v) : v) : typeof p.const == "number" && (p.const = String(p.const)), o && (p.type = "string", s || (p.pattern = (n.includes("number") ? Kc : h_).source)), p;
}
const Ul = /* @__PURE__ */ new WeakMap();
function ek(e) {
  const t = /* @__PURE__ */ new Map();
  for (const n of e.seen.values())
    n.def && !t.has(n.schema) && t.set(n.schema, n);
  const r = /* @__PURE__ */ new Map();
  for (const n of Ul.get(e) ?? []) {
    const o = e.seen.get(n), s = (o?.def ?? o?.schema)?.propertyNames;
    if (!s || s === !0 || r.has(s))
      continue;
    const i = Zl(t, s, /* @__PURE__ */ new Set());
    i !== s && r.set(s, i);
  }
  if (r.size)
    for (const n of e.seen.values())
      for (const o of [n.schema, n.def]) {
        const s = o && r.get(o.propertyNames);
        s && (o.propertyNames = s);
      }
}
const tk = (e, t, r, n) => {
  const o = r, s = e._zod.def;
  o.type = "object";
  const i = s.keyType, l = Rr(i).patterns;
  if (s.mode === "loose" && l && l.size > 0) {
    const d = Ct(s.valueType, t, {
      ...n,
      path: [...n.path, "patternProperties", "*"]
    });
    o.patternProperties = {};
    for (const f of l)
      zn(o.patternProperties, Rv(f).source, d);
  } else {
    if (t.target === "draft-07" || t.target === "draft-2020-12") {
      o.propertyNames = Ct(s.keyType, t, {
        ...n,
        path: [...n.path, "propertyNames"]
      });
      let d = Ul.get(t);
      d || (d = [], Ul.set(t, d), t.deferred.push(() => ek(t))), d.push(e);
    }
    o.additionalProperties = Ct(s.valueType, t, {
      ...n,
      path: [...n.path, "additionalProperties"]
    });
  }
  const c = i._zod.values, u = t.io === "input" && sa(s.valueType) !== void 0;
  if (c && !s.partial && !u) {
    const d = [...c].filter((f) => typeof f == "string" || typeof f == "number");
    d.length > 0 && (o.required = d.map(String));
  }
}, rk = (e, t, r, n) => {
  const o = e._zod.def, s = Ct(o.innerType, t, n), i = t.seen.get(e);
  t.target === "openapi-3.0" ? (i.ref = o.innerType, r.nullable = !0) : r.anyOf = [s, { type: "null" }];
}, nk = (e, t, r, n) => {
  const o = e._zod.def;
  Ct(o.innerType, t, n);
  const s = t.seen.get(e);
  s.ref = o.innerType;
}, Qc = /* @__PURE__ */ Symbol();
function Dv(e, t, r, n, o) {
  let s = !1;
  const i = JSON.stringify(e, (l, c) => typeof c != "bigint" ? c : (s = !0, null));
  return s ? (qn(t, r, n, o, "BigInt defaults cannot be represented in JSON Schema"), Qc) : JSON.parse(i);
}
const ok = (e, t, r, n) => {
  const o = e._zod.def;
  Ct(o.innerType, t, n);
  const s = t.seen.get(e);
  s.ref = o.innerType;
  const i = Dv(o.defaultValue, e, t, r, n);
  i !== Qc && (r.default = i);
}, sk = (e, t, r, n) => {
  const o = e._zod.def;
  Ct(o.innerType, t, n);
  const s = t.seen.get(e);
  if (s.ref = o.innerType, t.io !== "input")
    return;
  const i = Dv(o.defaultValue, e, t, r, n);
  i !== Qc && (r._prefault = i);
}, ik = (e, t, r, n) => {
  const o = e._zod.def;
  Ct(o.innerType, t, n);
  const s = t.seen.get(e);
  s.ref = o.innerType;
  let i;
  try {
    i = o.catchValue(void 0);
  } catch {
    qn(e, t, r, n, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  r.default = i;
}, ak = (e, t, r, n) => {
  const o = e._zod.def, s = o.in._zod.traits.has("$ZodTransform"), i = t.io === "input" ? s ? o.out : o.in : o.out;
  Ct(i, t, n);
  const l = t.seen.get(e);
  l.ref = i;
}, lk = (e, t, r, n) => {
  const o = e._zod.def;
  Ct(o.innerType, t, n);
  const s = t.seen.get(e);
  s.ref = o.innerType, r.readOnly = !0;
}, Lv = (e, t, r, n) => {
  const o = e._zod.def;
  Ct(o.innerType, t, n);
  const s = t.seen.get(e);
  s.ref = o.innerType;
}, tf = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function xi(e, t, r) {
  Object.defineProperty(e, t, {
    configurable: !0,
    enumerable: !1,
    get() {
      const n = r(this);
      return Object.defineProperty(this, t, { value: n, configurable: !0, writable: !0 }), n;
    },
    set(n) {
      Object.defineProperty(this, t, { value: n, configurable: !0, writable: !0 });
    }
  });
}
const ck = (e, t) => {
  $y.init(e, t), e.name = "ZodError";
  const r = Object.getPrototypeOf(e);
  tf.has(r) || (tf.add(r), xi(r, "format", (n) => (o) => Ey(n, o)), xi(r, "flatten", (n) => (o) => Ay(n, o)), xi(r, "addIssue", (n) => (o) => {
    n.issues.push(o), n.message = JSON.stringify(n.issues, Dl, 2);
  }), xi(r, "addIssues", (n) => (o) => {
    n.issues.push(...o), n.message = JSON.stringify(n.issues, Dl, 2);
  }), Object.defineProperty(r, "isEmpty", {
    configurable: !0,
    enumerable: !1,
    get() {
      return this.issues.length === 0;
    }
  }));
}, $r = /* @__PURE__ */ ae("ZodError", ck, void 0, {
  Parent: Error
}), uk = /* @__PURE__ */ Wc($r), dk = /* @__PURE__ */ Hc($r), fk = /* @__PURE__ */ qc($r), hk = /* @__PURE__ */ Gc($r), pk = /* @__PURE__ */ Py($r), vk = /* @__PURE__ */ Iy($r), gk = /* @__PURE__ */ Ry($r), mk = /* @__PURE__ */ Dy($r), bk = /* @__PURE__ */ Ly($r), xk = /* @__PURE__ */ jy($r), yk = /* @__PURE__ */ Vy($r), _k = /* @__PURE__ */ Fy($r);
function wk() {
  Vr.localeError || sn(Fw());
}
function za() {
  Vr.memoizer || sn({ memoizer: Lw() });
}
const $t = /* @__PURE__ */ ae("ZodType", (e, t) => (wk(), St.init(e, t), e.def = t, e.type = t.type, e), {
  check(...e) {
    const t = this.def;
    return this.clone(ur(t, {
      checks: [
        ...t.checks ?? [],
        ...e.map((r) => typeof r == "function" ? { _zod: { check: r, def: { check: "custom" }, onattach: [] } } : r)
      ]
    }), { parent: !0 });
  },
  with(...e) {
    return this.check(...e);
  },
  clone(e, t) {
    return Qn(this, e, t);
  },
  brand() {
    return this;
  },
  register(e, t) {
    return e.add(this, t), this;
  },
  refine(e, t) {
    return this.check(b4(e, t));
  },
  superRefine(e, t) {
    return this.check(x4(e, t));
  },
  overwrite(e) {
    return this.check(/* @__PURE__ */ ss(e));
  },
  optional() {
    return of(this);
  },
  exactOptional() {
    return s4(this);
  },
  nullable() {
    return sf(this);
  },
  nullish() {
    return of(sf(this));
  },
  nonoptional(e) {
    return d4(this, e);
  },
  array() {
    return ut(this);
  },
  or(e) {
    return Jk([this, e]);
  },
  and(e) {
    return t4(this, e);
  },
  transform(e) {
    return af(this, o4(e));
  },
  default(e) {
    return l4(this, e);
  },
  prefault(e) {
    return u4(this, e);
  },
  catch(e) {
    return h4(this, e);
  },
  pipe(e) {
    return af(this, e);
  },
  readonly() {
    return g4(this);
  },
  describe(e) {
    const t = this.clone();
    return xs.add(t, { description: e }), t;
  },
  meta(...e) {
    if (e.length === 0)
      return xs.get(this);
    const t = this.clone();
    return xs.add(t, e[0]), t;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(e, ...t) {
    return t.length === 0 ? e(this) : e(this, ...t);
  },
  // Overrides core's `~standard` to add `jsonSchema`. Must stay a prototype entry: redefining it per instance demotes instances to dictionary mode.
  get "~standard"() {
    return rv(this, "~standard", {
      ...uv(this),
      jsonSchema: {
        input: oa(this, "input"),
        output: oa(this, "output")
      }
    });
  },
  set "~standard"(e) {
    Hn(this, "~standard", e);
  },
  parse: function e(t, r) {
    return uk(this, t, r, { callee: e });
  },
  parseAsync: async function e(t, r) {
    return await dk(this, t, r, { callee: e });
  },
  safeParse(e, t) {
    return fk(this, e, t);
  },
  async safeParseAsync(e, t) {
    return hk(this, e, t);
  },
  // `spa` is an alias: same function object as `safeParseAsync`, as before.
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(e) {
    Hn(this, "spa", e);
  },
  validate(e, t) {
    return Cy(this, e, t);
  },
  validateAsync(e, t) {
    return Ny(this, e, t);
  },
  encode: function e(t, r) {
    return pk(this, t, r, { callee: e });
  },
  decode: function e(t, r) {
    return vk(this, t, r, { callee: e });
  },
  encodeAsync: async function e(t, r) {
    return await gk(this, t, r, { callee: e });
  },
  decodeAsync: async function e(t, r) {
    return await mk(this, t, r, { callee: e });
  },
  safeEncode(e, t) {
    return bk(this, e, t);
  },
  safeDecode(e, t) {
    return xk(this, e, t);
  },
  async safeEncodeAsync(e, t) {
    return yk(this, e, t);
  },
  async safeDecodeAsync(e, t) {
    return _k(this, e, t);
  },
  toJSONSchema(e) {
    return D2(this, {})(e);
  },
  // Reads through to the registry on every access, so it must not cache.
  get description() {
    return xs.get(this)?.description;
  },
  // No setter: `schema._def = x` throws, as it did when `_def` was a non-writable own property.
  get _def() {
    return this._zod.def;
  }
}), jv = /* @__PURE__ */ ae(
  "_ZodString",
  (e, t) => {
    Xc.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => F2(e, r, n);
  },
  /* @__PURE__ */ nv({
    format: (e) => Rr(e).format ?? null,
    minLength: (e) => Rr(e).minimum ?? null,
    maxLength: (e) => Rr(e).maximum ?? null
  }, {
    regex(...e) {
      return this.check(/* @__PURE__ */ _2(...e));
    },
    includes(...e) {
      return this.check(/* @__PURE__ */ S2(...e));
    },
    startsWith(...e) {
      return this.check(/* @__PURE__ */ $2(...e));
    },
    endsWith(...e) {
      return this.check(/* @__PURE__ */ z2(...e));
    },
    min(...e) {
      return this.check(/* @__PURE__ */ na(...e));
    },
    max(...e) {
      return this.check(/* @__PURE__ */ $v(...e));
    },
    length(...e) {
      return this.check(/* @__PURE__ */ zv(...e));
    },
    nonempty(...e) {
      return this.check(/* @__PURE__ */ na(1, ...e));
    },
    lowercase(e) {
      return this.check(/* @__PURE__ */ w2(e));
    },
    uppercase(e) {
      return this.check(/* @__PURE__ */ k2(e));
    },
    trim() {
      return this.check(/* @__PURE__ */ E2());
    },
    normalize(...e) {
      return this.check(/* @__PURE__ */ A2(...e));
    },
    toLowerCase() {
      return this.check(/* @__PURE__ */ M2());
    },
    toUpperCase() {
      return this.check(/* @__PURE__ */ T2());
    },
    slugify() {
      return this.check(/* @__PURE__ */ C2());
    }
  })
), kk = /* @__PURE__ */ ae("ZodString", (e, t) => {
  Xc.init(e, t), jv.init(e, t);
}, {
  email(e) {
    return this.check(/* @__PURE__ */ Ww(Ak, e));
  },
  url(e) {
    return this.check(/* @__PURE__ */ Xw(Mk, e));
  },
  jwt(e) {
    return this.check(/* @__PURE__ */ f2(Bk, e));
  },
  emoji(e) {
    return this.check(/* @__PURE__ */ Jw(Tk, e));
  },
  guid(e) {
    return this.check(/* @__PURE__ */ Hw(Ek, e));
  },
  uuid(e) {
    return this.check(/* @__PURE__ */ qw(yi, e));
  },
  uuidv4(e) {
    return this.check(/* @__PURE__ */ Gw(yi, e));
  },
  uuidv6(e) {
    return this.check(/* @__PURE__ */ Kw(yi, e));
  },
  uuidv7(e) {
    return this.check(/* @__PURE__ */ Yw(yi, e));
  },
  nanoid(e) {
    return this.check(/* @__PURE__ */ Qw(Ck, e));
  },
  cuid(e) {
    return this.check(/* @__PURE__ */ e2(Ok, e));
  },
  cuid2(e) {
    return this.check(/* @__PURE__ */ t2(Nk, e));
  },
  ulid(e) {
    return this.check(/* @__PURE__ */ r2(Pk, e));
  },
  base64(e) {
    return this.check(/* @__PURE__ */ c2(Fk, e));
  },
  base64url(e) {
    return this.check(/* @__PURE__ */ u2(Zk, e));
  },
  xid(e) {
    return this.check(/* @__PURE__ */ n2(Ik, e));
  },
  ksuid(e) {
    return this.check(/* @__PURE__ */ o2(Rk, e));
  },
  ipv4(e) {
    return this.check(/* @__PURE__ */ s2(Dk, e));
  },
  ipv6(e) {
    return this.check(/* @__PURE__ */ i2(Lk, e));
  },
  cidrv4(e) {
    return this.check(/* @__PURE__ */ a2(jk, e));
  },
  cidrv6(e) {
    return this.check(/* @__PURE__ */ l2(Vk, e));
  },
  e164(e) {
    return this.check(/* @__PURE__ */ d2(Uk, e));
  },
  datetime(e) {
    return this.check(/* @__PURE__ */ Sv(Vv, e));
  },
  date(e) {
    return this.check(/* @__PURE__ */ h2(Sk, e));
  },
  time(e) {
    return this.check(/* @__PURE__ */ p2($k, e));
  },
  duration(e) {
    return this.check(/* @__PURE__ */ v2(zk, e));
  }
});
function We(e) {
  return /* @__PURE__ */ Bw(kk, e);
}
const zt = /* @__PURE__ */ ae("ZodStringFormat", (e, t) => {
  wt.init(e, t), jv.init(e, t);
}), Vv = /* @__PURE__ */ ae("ZodISODateTime", (e, t) => {
  G_.init(e, t), zt.init(e, t);
}), Sk = /* @__PURE__ */ ae("ZodISODate", (e, t) => {
  K_.init(e, t), zt.init(e, t);
}), $k = /* @__PURE__ */ ae("ZodISOTime", (e, t) => {
  Y_.init(e, t), zt.init(e, t);
}), zk = /* @__PURE__ */ ae("ZodISODuration", (e, t) => {
  X_.init(e, t), zt.init(e, t);
}), Ak = /* @__PURE__ */ ae("ZodEmail", (e, t) => {
  P_.init(e, t), zt.init(e, t);
}), Ek = /* @__PURE__ */ ae("ZodGUID", (e, t) => {
  O_.init(e, t), zt.init(e, t);
}), yi = /* @__PURE__ */ ae("ZodUUID", (e, t) => {
  N_.init(e, t), zt.init(e, t);
}), Mk = /* @__PURE__ */ ae("ZodURL", (e, t) => {
  V_.init(e, t), zt.init(e, t);
}), Tk = /* @__PURE__ */ ae("ZodEmoji", (e, t) => {
  F_.init(e, t), zt.init(e, t);
}), Ck = /* @__PURE__ */ ae("ZodNanoID", (e, t) => {
  Z_.init(e, t), zt.init(e, t);
}), Ok = /* @__PURE__ */ ae("ZodCUID", (e, t) => {
  U_.init(e, t), zt.init(e, t);
}), Nk = /* @__PURE__ */ ae("ZodCUID2", (e, t) => {
  B_.init(e, t), zt.init(e, t);
}), Pk = /* @__PURE__ */ ae("ZodULID", (e, t) => {
  W_.init(e, t), zt.init(e, t);
}), Ik = /* @__PURE__ */ ae("ZodXID", (e, t) => {
  H_.init(e, t), zt.init(e, t);
}), Rk = /* @__PURE__ */ ae("ZodKSUID", (e, t) => {
  q_.init(e, t), zt.init(e, t);
}), Dk = /* @__PURE__ */ ae("ZodIPv4", (e, t) => {
  J_.init(e, t), zt.init(e, t);
}), Lk = /* @__PURE__ */ ae("ZodIPv6", (e, t) => {
  ew.init(e, t), zt.init(e, t);
}), jk = /* @__PURE__ */ ae("ZodCIDRv4", (e, t) => {
  tw.init(e, t), zt.init(e, t);
}), Vk = /* @__PURE__ */ ae("ZodCIDRv6", (e, t) => {
  nw.init(e, t), zt.init(e, t);
}), Fk = /* @__PURE__ */ ae("ZodBase64", (e, t) => {
  ow.init(e, t), zt.init(e, t);
}), Zk = /* @__PURE__ */ ae("ZodBase64URL", (e, t) => {
  iw.init(e, t), zt.init(e, t);
}), Uk = /* @__PURE__ */ ae("ZodE164", (e, t) => {
  aw.init(e, t), zt.init(e, t);
}), Bk = /* @__PURE__ */ ae("ZodJWT", (e, t) => {
  cw.init(e, t), zt.init(e, t);
}), Fv = /* @__PURE__ */ ae(
  "ZodNumber",
  (e, t) => {
    gv.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => Z2(e, r, n, o), e.isFinite = !0;
  },
  /* @__PURE__ */ nv({
    minValue: (e) => {
      const { minimum: t, exclusiveMinimum: r } = Rr(e);
      return Math.max(t ?? Number.NEGATIVE_INFINITY, r ?? Number.NEGATIVE_INFINITY);
    },
    maxValue: (e) => {
      const { maximum: t, exclusiveMaximum: r } = Rr(e);
      return Math.min(t ?? Number.POSITIVE_INFINITY, r ?? Number.POSITIVE_INFINITY);
    },
    isInt: (e) => {
      const { isInt: t, multipleOf: r } = Rr(e);
      return !!t || !!r?.some(Number.isSafeInteger);
    },
    format: (e) => Rr(e).format ?? null
  }, {
    gt(e, t) {
      return this.check(/* @__PURE__ */ Hd(e, t));
    },
    gte(e, t) {
      return this.check(/* @__PURE__ */ sl(e, t));
    },
    min(e, t) {
      return this.check(/* @__PURE__ */ sl(e, t));
    },
    lt(e, t) {
      return this.check(/* @__PURE__ */ Wd(e, t));
    },
    lte(e, t) {
      return this.check(/* @__PURE__ */ ol(e, t));
    },
    max(e, t) {
      return this.check(/* @__PURE__ */ ol(e, t));
    },
    int(e) {
      return this.check(rf(e));
    },
    safe(e) {
      return this.check(rf(e));
    },
    positive(e) {
      return this.check(/* @__PURE__ */ Hd(0, e));
    },
    nonnegative(e) {
      return this.check(/* @__PURE__ */ sl(0, e));
    },
    negative(e) {
      return this.check(/* @__PURE__ */ Wd(0, e));
    },
    nonpositive(e) {
      return this.check(/* @__PURE__ */ ol(0, e));
    },
    multipleOf(e, t) {
      return this.check(/* @__PURE__ */ qd(e, t));
    },
    step(e, t) {
      return this.check(/* @__PURE__ */ qd(e, t));
    },
    finite() {
      return this;
    }
  })
);
function kn(e) {
  return /* @__PURE__ */ g2(Fv, e);
}
const Wk = /* @__PURE__ */ ae("ZodNumberFormat", (e, t) => {
  uw.init(e, t), Fv.init(e, t);
});
function rf(e) {
  return /* @__PURE__ */ m2(Wk, e);
}
const Hk = /* @__PURE__ */ ae("ZodBoolean", (e, t) => {
  dw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => U2(e, r, n);
});
function Ms(e) {
  return /* @__PURE__ */ b2(Hk, e);
}
const qk = /* @__PURE__ */ ae("ZodUnknown", (e, t) => {
  fw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => W2();
});
function Go() {
  return /* @__PURE__ */ x2(qk);
}
const Gk = /* @__PURE__ */ ae("ZodNever", (e, t) => {
  hw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => B2(e, r, n);
});
function Kk(e) {
  return /* @__PURE__ */ y2(Gk, e);
}
const Yk = /* @__PURE__ */ ae("ZodArray", (e, t) => {
  za(), pw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => Y2(e, r, n, o), e.element = t.element;
}, {
  min(e, t) {
    return this.check(/* @__PURE__ */ na(e, t));
  },
  nonempty(e) {
    return this.check(/* @__PURE__ */ na(1, e));
  },
  max(e, t) {
    return this.check(/* @__PURE__ */ $v(e, t));
  },
  length(e, t) {
    return this.check(/* @__PURE__ */ zv(e, t));
  },
  unwrap() {
    return this.element;
  }
});
function ut(e, t) {
  return /* @__PURE__ */ O2(Yk, e, t);
}
const Xk = /* @__PURE__ */ ae("ZodObject", (e, t) => {
  za(), mw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => X2(e, r, n, o), my(e, "shape", (r) => r._zod.def.shape, !1);
}, {
  keyof() {
    return hr(Object.keys(this._zod.def.shape));
  },
  catchall(e) {
    return this.clone(ur(this._zod.def, { catchall: e }));
  },
  passthrough() {
    return this.clone(ur(this._zod.def, { catchall: Go() }));
  },
  loose() {
    return this.clone(ur(this._zod.def, { catchall: Go() }));
  },
  strict() {
    return this.clone(ur(this._zod.def, { catchall: Kk() }));
  },
  strip() {
    return this.clone(ur(this._zod.def, { catchall: void 0 }));
  },
  extend(e) {
    return iy(this, e);
  },
  safeExtend(e) {
    return ay(this, e);
  },
  merge(e) {
    return ly(this, e);
  },
  pick(e) {
    return oy(this, e);
  },
  omit(e) {
    return sy(this, e);
  },
  partial(...e) {
    return Ad(Uv, this, e[0]);
  },
  exactPartial(...e) {
    return Ad(Bv, this, e[0], "exactPartial");
  },
  required(...e) {
    return cy(Wv, this, e[0]);
  }
});
function et(e, t) {
  return new Xk({
    type: "object",
    shape: e,
    catchall: Go(),
    ...Ue(t)
  });
}
const Zv = /* @__PURE__ */ ae("ZodUnion", (e, t) => {
  xv.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => J2(e, r, n, o), e.options = t.options;
});
function Jk(e, t) {
  return new Zv({
    type: "union",
    options: e,
    ...Ue(t)
  });
}
const Qk = /* @__PURE__ */ ae("ZodDiscriminatedUnion", (e, t) => {
  Zv.init(e, t), xw.init(e, t);
});
function eu(e, t, r) {
  return new Qk({
    type: "union",
    options: t,
    discriminator: e,
    ...Ue(r)
  });
}
const e4 = /* @__PURE__ */ ae("ZodIntersection", (e, t) => {
  yw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => Q2(e, r, n, o);
});
function t4(e, t) {
  return new e4({
    type: "intersection",
    left: e,
    right: t
  });
}
const nf = /* @__PURE__ */ ae("ZodRecord", (e, t) => {
  za(), _w.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => tk(e, r, n, o), e.keyType = t.keyType, e.valueType = t.valueType;
});
function Bl(e, t, r) {
  return !t || !t._zod ? new nf({
    type: "record",
    keyType: We(),
    valueType: e,
    ...Ue(t)
  }) : new nf({
    type: "record",
    keyType: e,
    valueType: t,
    ...Ue(r)
  });
}
const Wl = /* @__PURE__ */ ae("ZodEnum", (e, t) => {
  ww.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (n, o, s) => H2(e, n, o), e.enum = t.entries, e.options = [...e._zod.values];
  const r = new Set(Object.keys(t.entries));
  e.extract = (n, o) => {
    const s = {};
    for (const i of n)
      if (r.has(i))
        s[i] = t.entries[i];
      else
        throw new Error(`Key ${i} not found in enum`);
    return new Wl({
      ...t,
      checks: [],
      ...Ue(o),
      entries: s
    });
  }, e.exclude = (n, o) => {
    const s = { ...t.entries };
    for (const i of n)
      if (r.has(i))
        delete s[i];
      else
        throw new Error(`Key ${i} not found in enum`);
    return new Wl({
      ...t,
      checks: [],
      ...Ue(o),
      entries: s
    });
  };
});
function hr(e, t) {
  const r = Array.isArray(e) ? Object.fromEntries(e.map((n) => [n, n])) : e;
  return new Wl({
    type: "enum",
    entries: r,
    ...Ue(t)
  });
}
const r4 = /* @__PURE__ */ ae("ZodLiteral", (e, t) => {
  kw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => q2(e, r, n, o), e.values = new Set(t.values), Object.defineProperty(e, "value", {
    get() {
      if (t.values.length > 1)
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      return t.values[0];
    }
  });
});
function yr(e, t) {
  return new r4({
    type: "literal",
    values: Array.isArray(e) ? e : [e],
    ...Ue(t)
  });
}
const n4 = /* @__PURE__ */ ae("ZodTransform", (e, t) => {
  za(), Sw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => K2(e, r, n, o), e._zod.parse = (r, n) => {
    if (n.direction === "backward")
      throw new ov(e.constructor.name);
    r.addIssue = (s) => {
      if (typeof s == "string")
        r.issues.push(Ps(s, r.value, t));
      else {
        const i = s;
        i.fatal && (i.continue = !1), i.code ?? (i.code = "custom"), "input" in i || (i.input = r.value), i.inst ?? (i.inst = e), r.issues.push(Ps(i));
      }
    };
    const o = t.transform(r.value, r);
    return o instanceof Promise ? o.then((s) => (r.value = s, r)) : (r.value = o, r);
  };
});
function o4(e) {
  return new n4({
    type: "transform",
    transform: e
  });
}
const Uv = /* @__PURE__ */ ae("ZodOptional", (e, t) => {
  yv.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => Lv(e, r, n, o), e.unwrap = () => e._zod.def.innerType;
});
function of(e) {
  return new Uv({
    type: "optional",
    innerType: e
  });
}
const Bv = /* @__PURE__ */ ae("ZodExactOptional", (e, t) => {
  $w.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => Lv(e, r, n, o), e.unwrap = () => e._zod.def.innerType;
});
function s4(e) {
  return new Bv({
    type: "optional",
    innerType: e
  });
}
const i4 = /* @__PURE__ */ ae("ZodNullable", (e, t) => {
  zw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => rk(e, r, n, o), e.unwrap = () => e._zod.def.innerType;
});
function sf(e) {
  return new i4({
    type: "nullable",
    innerType: e
  });
}
const a4 = /* @__PURE__ */ ae("ZodDefault", (e, t) => {
  Aw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => ok(e, r, n, o), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function l4(e, t) {
  return new a4({
    type: "default",
    innerType: e,
    get defaultValue() {
      return typeof t == "function" ? t() : Jp(t);
    }
  });
}
const c4 = /* @__PURE__ */ ae("ZodPrefault", (e, t) => {
  Ew.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => sk(e, r, n, o), e.unwrap = () => e._zod.def.innerType;
});
function u4(e, t) {
  return new c4({
    type: "prefault",
    innerType: e,
    get defaultValue() {
      return typeof t == "function" ? t() : Jp(t);
    }
  });
}
const Wv = /* @__PURE__ */ ae("ZodNonOptional", (e, t) => {
  Mw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => nk(e, r, n, o), e.unwrap = () => e._zod.def.innerType;
});
function d4(e, t) {
  return new Wv({
    type: "nonoptional",
    innerType: e,
    ...Ue(t)
  });
}
const f4 = /* @__PURE__ */ ae("ZodCatch", (e, t) => {
  Tw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => ik(e, r, n, o), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function h4(e, t) {
  return new f4({
    type: "catch",
    innerType: e,
    catchValue: typeof t == "function" ? t : xy(t)
  });
}
const p4 = /* @__PURE__ */ ae("ZodPipe", (e, t) => {
  Cw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => ak(e, r, n, o), e.in = t.in, e.out = t.out;
});
function af(e, t) {
  return new p4({
    type: "pipe",
    in: e,
    out: t
    // ...util.normalizeParams(params),
  });
}
const v4 = /* @__PURE__ */ ae("ZodReadonly", (e, t) => {
  Ow.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => lk(e, r, n, o), e.unwrap = () => e._zod.def.innerType;
});
function g4(e) {
  return new v4({
    type: "readonly",
    innerType: e
  });
}
const m4 = /* @__PURE__ */ ae("ZodCustom", (e, t) => {
  Nw.init(e, t), $t.init(e, t), e._zod.processJSONSchema = (r, n, o) => G2(e, r, n, o);
});
function b4(e, t = {}) {
  return /* @__PURE__ */ N2(m4, e, t);
}
function x4(e, t) {
  return /* @__PURE__ */ P2(e, t);
}
function lf(e) {
  return /* @__PURE__ */ Sv(Vv, e);
}
const He = We().min(1), Hl = kn().refine(Number.isFinite, "must be a finite number"), tu = hr(["entity", "observation", "document"]), y4 = hr(["entities", "passages", "facts", "graph", "metric", "table", "timeline"]);
hr(["projection", "query"]);
const _4 = et({
  name: He,
  version: He,
  inputs: ut(tu),
  resultKinds: ut(y4),
  rebuild: hr(["deterministic", "reconstructible", "unsupported"])
}), w4 = et({
  state: hr(["connected", "ready", "degraded", "unavailable"]),
  message: We(),
  checkpoint: We().optional(),
  pending: kn().int().nonnegative().optional(),
  engineVersion: We().optional()
}), ru = et({
  path: He,
  startLine: kn().int().positive().optional(),
  endLine: kn().int().positive().optional()
}), ql = et({
  source: He,
  repository: We().optional(),
  path: We().optional(),
  lines: We().optional(),
  symbol: We().optional(),
  key: We().optional(),
  method: We().optional(),
  endpoint: We().optional(),
  urls: ut(We()).optional(),
  commit: We().optional(),
  observedAt: We().optional(),
  observedBy: We().optional(),
  session: We().optional(),
  note: We().optional()
}), cf = {
  confidence: kn().min(0).max(1),
  basis: hr(["evidence", "stated", "unevidenced"]),
  evidenceCount: kn().int().nonnegative(),
  sources: ut(We())
}, nu = {
  id: He,
  revision: He,
  scope: He
}, k4 = et({
  ...nu,
  ...cf,
  kind: yr("entity"),
  type: He,
  title: We(),
  path: He,
  paths: ut(He).min(1),
  tags: ut(We()),
  attributes: Bl(We(), Go()),
  links: ut(et({
    ...cf,
    rel: He,
    target: He,
    attributes: Bl(We(), Go()).optional(),
    evidence: ut(ql)
  })),
  content: We(),
  mentions: ut(We()),
  evidence: ut(ql),
  provenance: et({
    authority: We().optional(),
    confidence: kn().min(0).max(1).optional(),
    capturedBy: We().optional()
  }).optional(),
  index: et({ graph: Ms(), fts: Ms(), vector: Ms() })
}), S4 = et({
  ...nu,
  kind: yr("observation"),
  text: We(),
  sources: ut(ru),
  entityRefs: ut(He),
  observedAt: He.optional(),
  eventAt: We().optional(),
  validFrom: We().optional(),
  validTo: We().optional(),
  recordedIn: ut(He).optional(),
  evidence: ql.optional(),
  relationship: et({ source: He, rel: He, target: He }).optional()
}), $4 = et({
  ...nu,
  kind: yr("document"),
  text: We(),
  source: ru,
  entityRefs: ut(He)
}), z4 = eu("kind", [
  k4,
  S4,
  $4
]), A4 = eu("operation", [
  et({ operation: yr("upsert"), record: z4 }),
  et({ operation: yr("remove"), kind: tu, id: He, revision: He })
]);
et({
  batchId: He,
  scope: He,
  checkpoint: He,
  changes: ut(A4)
});
et({
  batchId: He,
  applied: ut(He),
  failed: ut(et({ id: He, retryable: Ms(), message: We() }))
});
et({
  requestId: He,
  question: He,
  context: et({
    scope: He,
    now: lf({ offset: !0 }),
    timezone: He,
    conversation: ut(et({ role: hr(["user", "assistant"]), content: We() })).optional()
  }),
  budget: et({
    maxResults: kn().int().positive(),
    maxEvidenceBytes: kn().int().positive(),
    deadline: lf({ offset: !0 })
  })
});
const ia = et({
  kind: tu,
  id: He,
  revision: He.optional(),
  span: ru.optional()
}).refine((e) => e.span === void 0 || e.revision !== void 0, {
  message: "a source span needs the revision its lines refer to",
  path: ["revision"]
}), E4 = et({
  id: He,
  nativeId: We().optional(),
  kind: hr(["passage", "observation", "derived-fact"]),
  text: We(),
  canonicalRefs: ut(ia),
  observedAt: We().optional(),
  eventAt: We().optional(),
  score: Hl.optional(),
  derivation: et({ engine: He, model: We().optional() }).optional()
}), Mo = ut(He), io = {
  id: He,
  title: We().optional(),
  evidenceIds: Mo
}, M4 = hr(["string", "number", "integer", "decimal", "boolean", "date", "datetime", "reference"]), T4 = eu("kind", [
  et({
    ...io,
    kind: yr("entities"),
    entities: ut(et({ ref: ia, score: Hl.optional(), detail: We().optional() }))
  }),
  et({ ...io, kind: yr("passages"), evidenceIds: Mo.min(1) }),
  et({ ...io, kind: yr("facts"), evidenceIds: Mo.min(1) }),
  et({
    ...io,
    kind: yr("graph"),
    nodes: ut(et({ id: He, label: We(), type: We().optional(), ref: ia.optional() })),
    edges: ut(et({ source: He, target: He, rel: He, evidenceIds: Mo.optional() })),
    paths: ut(ut(He).min(1)).optional()
  }),
  et({ ...io, kind: yr("metric"), label: He, value: Hl, unit: We().optional() }),
  et({
    ...io,
    kind: yr("table"),
    columns: ut(et({ key: He, label: We(), type: M4 })),
    rows: ut(et({
      cells: Bl(We(), Go()),
      evidenceIds: Mo.optional()
    }))
  }),
  et({
    ...io,
    kind: yr("timeline"),
    events: ut(et({
      label: He,
      at: He,
      semantics: hr(["event", "observed", "valid-from", "valid-to"]),
      evidenceIds: Mo.optional()
    }))
  })
]), C4 = (e, t) => {
  if (t !== null)
    switch (e) {
      case "string":
      case "date":
      case "datetime":
        return typeof t == "string" ? void 0 : `a ${e} cell must be a string`;
      case "number":
        return typeof t == "number" && Number.isFinite(t) ? void 0 : "a number cell must be a finite number";
      case "integer":
        return Number.isSafeInteger(t) ? void 0 : "an integer cell must be a safe integer - use a decimal column for larger values";
      case "decimal":
        return typeof t == "string" && /^-?\d+(\.\d+)?$/.test(t) ? void 0 : 'a decimal cell must be a string of digits, e.g. "9007199254740993"';
      case "boolean":
        return typeof t == "boolean" ? void 0 : "a boolean cell must be true or false";
      case "reference":
        return ia.safeParse(t).success ? void 0 : "a reference cell must be a canonical reference";
    }
}, Gl = (e, t = []) => {
  const r = () => t.length === 0 ? "the value" : t.join(".");
  if (e == null)
    return;
  switch (typeof e) {
    case "string":
    case "boolean":
      return;
    case "number":
      return Number.isFinite(e) ? void 0 : `${r()} is not a finite number`;
    case "bigint":
      return `${r()} is a BigInt - use a decimal string`;
    case "function":
    case "symbol":
      return `${r()} is a ${typeof e}`;
  }
  if (Array.isArray(e)) {
    for (const [o, s] of e.entries()) {
      const i = Gl(s, [...t, o]);
      if (i)
        return i;
    }
    return;
  }
  const n = Object.getPrototypeOf(e);
  if (n !== Object.prototype && n !== null) {
    const o = e.constructor?.name ?? "object";
    return `${r()} is a ${o}, not a plain JSON object`;
  }
  for (const [o, s] of Object.entries(e)) {
    const i = Gl(s, [...t, o]);
    if (i)
      return i;
  }
}, O4 = (e) => {
  const t = [], r = (n, o) => {
    for (const [s, i] of (n ?? []).entries())
      t.push({ id: i, path: [...o, "evidenceIds", s] });
  };
  for (const [n, o] of e.entries()) {
    const s = ["blocks", n];
    if (r(o.evidenceIds, s), o.kind === "graph")
      for (const [i, l] of o.edges.entries())
        r(l.evidenceIds, [...s, "edges", i]);
    if (o.kind === "table")
      for (const [i, l] of o.rows.entries())
        r(l.evidenceIds, [...s, "rows", i]);
    if (o.kind === "timeline")
      for (const [i, l] of o.events.entries())
        r(l.evidenceIds, [...s, "events", i]);
  }
  return t;
}, _i = (e) => [...new Set(e.filter((t, r) => e.indexOf(t) !== r))], N4 = et({
  interpretation: et({
    description: We(),
    assumptions: ut(We()),
    timeRange: et({ from: He, to: He }).optional(),
    nativeQuery: We().optional()
  }),
  blocks: ut(T4),
  evidence: ut(E4),
  coverage: et({
    mode: hr(["exhaustive", "top-k", "unknown"]),
    truncated: Ms(),
    scope: He,
    checkpoint: We().optional()
  }),
  diagnostics: ut(et({ severity: hr(["info", "warning", "error"]), code: He, message: We() }))
}).superRefine((e, t) => {
  const r = Gl(e);
  r && t.addIssue({ code: "custom", message: `answers must be plain JSON: ${r}` });
  const n = e.evidence.map((s) => s.id);
  for (const s of _i(n))
    t.addIssue({ code: "custom", path: ["evidence"], message: `evidence id "${s}" is used more than once` });
  for (const s of _i(e.blocks.map((i) => i.id)))
    t.addIssue({ code: "custom", path: ["blocks"], message: `block id "${s}" is used more than once` });
  const o = new Set(n);
  for (const s of O4(e.blocks))
    o.has(s.id) || t.addIssue({ code: "custom", path: s.path, message: `no evidence has id "${s.id}"` });
  for (const [s, i] of e.blocks.entries()) {
    if (i.kind === "graph") {
      const l = new Set(i.nodes.map((c) => c.id));
      for (const c of _i(i.nodes.map((u) => u.id)))
        t.addIssue({ code: "custom", path: ["blocks", s, "nodes"], message: `node id "${c}" is used more than once` });
      for (const [c, u] of i.edges.entries())
        for (const d of [u.source, u.target])
          l.has(d) || t.addIssue({ code: "custom", path: ["blocks", s, "edges", c], message: `edge end "${d}" is not a node` });
      for (const [c, u] of (i.paths ?? []).entries())
        for (const d of u)
          l.has(d) || t.addIssue({ code: "custom", path: ["blocks", s, "paths", c], message: `path node "${d}" is not a node` });
    }
    if (i.kind === "table") {
      const l = new Map(i.columns.map((c) => [c.key, c]));
      for (const c of _i(i.columns.map((u) => u.key)))
        t.addIssue({ code: "custom", path: ["blocks", s, "columns"], message: `column "${c}" is declared more than once` });
      for (const [c, u] of i.rows.entries())
        for (const [d, f] of Object.entries(u.cells)) {
          const h = l.get(d), p = h ? C4(h.type, f) : `column "${d}" is not declared`;
          p && t.addIssue({ code: "custom", path: ["blocks", s, "rows", c, "cells", d], message: p });
        }
    }
  }
});
class ou extends Error {
  summary;
  issues;
  constructor(t, r) {
    super(r.length === 0 ? t : `${t}:
${r.map((n) => `  - ${n}`).join(`
`)}`), this.summary = t, this.issues = r, this.name = "ContractError";
  }
}
const P4 = (e) => e.issues.map((t) => t.path.length === 0 ? t.message : `${t.path.join(".")}: ${t.message}`), su = (e, t, r) => {
  const n = e.safeParse(t);
  if (!n.success)
    throw new ou(`invalid ${r}`, P4(n.error));
  return n.data;
}, I4 = (e) => su(_4, e, "adapter description"), R4 = (e) => su(w4, e, "adapter status"), D4 = (e, t) => su(N4, e, "adapter answer"), Hv = 10, L4 = "default", j4 = (e) => ({ severity: e.severity, code: e.code, message: e.message }), V4 = (e) => e.synced ? e.behind > 0 ? [{ severity: "warning", code: "index-behind", message: `${e.behind === 1 ? "1 file has" : `${e.behind} files have`} changed since the last sync; search may miss them. Run \`docket sync\`.` }] : [] : [{ severity: "warning", code: "index-not-synced", message: "The search index has not been synced, so search may find nothing. Run `docket sync`." }], F4 = (e) => {
  if (e.error !== void 0)
    return { adapter: e.name, state: "failed", error: { code: "unavailable", message: e.error } };
  const t = {
    interpretation: { description: e.note ?? "", assumptions: [] },
    blocks: e.hits.length === 0 ? [] : [
      {
        kind: "entities",
        id: `${e.name}:hits`,
        title: "Exhibits found",
        evidenceIds: [],
        entities: e.hits.map((r) => ({
          ref: { kind: "entity", id: r.id },
          ...r.score === void 0 ? {} : { score: r.score },
          ...r.detail === void 0 ? {} : { detail: r.detail }
        }))
      }
    ],
    evidence: [],
    coverage: { mode: "top-k", truncated: e.hits.length >= Hv, scope: L4 },
    diagnostics: []
  };
  return { adapter: e.name, state: "answered", answer: t };
}, qv = (e, t) => ({
  requestId: t,
  question: e.query,
  results: e.sources.map(F4),
  synthesis: null,
  connections: e.paths,
  diagnostics: [...V4(e.index), ...e.diagnostics.map(j4)]
}), Z4 = (e, t) => ({
  ...qv(e.answer, t),
  question: e.query,
  synthesis: e.summary ? {
    text: e.summary.text,
    citedEvidence: [],
    citedEntities: e.summary.cited,
    model: e.summary.model,
    cached: e.summary.cached,
    createdAt: e.summary.createdAt
  } : null,
  ...e.notice ? { notice: e.notice } : {}
}), U4 = ["entities", "passages", "facts", "graph", "metric", "table", "timeline"], Dr = (e) => typeof e == "object" && e !== null && !Array.isArray(e), B4 = (e) => typeof e == "string" && U4.includes(e), W4 = (e, t) => {
  const r = Dr(e) ? e : { value: e };
  return {
    id: typeof r.id == "string" && r.id !== "" ? r.id : `block-${t}`,
    kind: typeof r.kind == "string" ? r.kind : "unknown",
    ...typeof r.title == "string" ? { title: r.title } : {},
    evidenceIds: Array.isArray(r.evidenceIds) ? r.evidenceIds.filter((n) => typeof n == "string") : [],
    raw: r
  };
}, H4 = (e, t, r, n = {}) => {
  const o = r === void 0 ? {} : { durationMs: r }, s = Dr(t) && Array.isArray(t.blocks) ? t.blocks : null, i = [], l = /* @__PURE__ */ new Map();
  s?.forEach((v, g) => {
    Dr(v) && B4(v.kind) ? i.push(g) : l.set(g, W4(v, g));
  });
  const c = (v) => ({
    adapter: e,
    state: "failed",
    error: { code: "invalid-answer", message: `${e} returned an answer that breaks the adapter contract.` },
    issues: v,
    ...o
  });
  let u;
  try {
    const v = s ? i.map((g) => s[g]) : void 0;
    u = D4(s ? { ...t, blocks: v } : t);
  } catch (v) {
    if (!(v instanceof ou)) throw v;
    const g = v.issues.map(
      (y) => y.replace(/^blocks\.(\d+)/, (_, k) => `blocks.${i[Number(k)] ?? k}`)
    );
    return c(g);
  }
  const d = [];
  let f = 0;
  for (let v = 0; v < (s?.length ?? 0); v += 1) {
    const g = l.get(v);
    if (g) d.push({ known: !1, block: g });
    else {
      const y = u.blocks[f];
      f += 1, y && d.push({ known: !0, block: y });
    }
  }
  const h = d.map(({ block: v }) => v.id), p = [...new Set(h.filter((v, g) => h.indexOf(v) !== g))];
  return p.length > 0 ? c(p.map((v) => `blocks: block id "${v}" is used more than once`)) : {
    adapter: e,
    state: "answered",
    answer: u,
    blocks: d,
    evidence: new Map(u.evidence.map((v) => [v.id, v])),
    ...o,
    ...Dr(n.references) ? { references: n.references } : {},
    ...Dr(n.freshness) ? { freshness: n.freshness } : {}
  };
}, q4 = (e) => e.state === "answered" ? H4(e.adapter, e.answer, e.durationMs, {
  ...e.references ? { references: e.references } : {},
  ...e.freshness ? { freshness: e.freshness } : {}
}) : {
  adapter: e.adapter,
  state: "failed",
  error: e.error,
  ...Array.isArray(e.issues) ? { issues: e.issues.filter((t) => typeof t == "string") } : {},
  ...e.durationMs === void 0 ? {} : { durationMs: e.durationMs }
};
class G4 extends Error {
  name = "AnswerShapeError";
}
const K4 = (e) => Dr(e) && typeof e.adapter == "string" && (e.state === "answered" && "answer" in e || e.state === "failed" && Dr(e.error) && typeof e.error.message == "string"), il = (e, t) => {
  if (!Dr(e) || !Array.isArray(e.results) || typeof e.question != "string")
    throw new G4("The server answered, but not with a coordinated answer.");
  const r = e.results.map(
    (o, s) => K4(o) ? q4(o) : {
      adapter: Dr(o) && typeof o.adapter == "string" ? o.adapter : `result ${s + 1}`,
      state: "failed",
      error: { code: "invalid-result", message: "The coordinator returned a result this UI cannot read." }
    }
  ), n = e;
  return {
    requestId: typeof n.requestId == "string" ? n.requestId : "",
    question: n.question,
    results: r,
    synthesis: Dr(n.synthesis) && typeof n.synthesis.text == "string" ? n.synthesis : null,
    ...Dr(n.notice) ? { notice: n.notice } : {},
    connections: Array.isArray(n.connections) ? n.connections : [],
    diagnostics: Array.isArray(n.diagnostics) ? n.diagnostics : [],
    via: t
  };
}, Y4 = (e) => {
  const t = /* @__PURE__ */ new Map();
  for (const r of e.results)
    if (r.state === "answered")
      for (const n of r.answer.evidence)
        t.has(n.id) || t.set(n.id, { adapter: r.adapter, evidence: n });
  return t;
}, X4 = (e) => {
  const t = /* @__PURE__ */ new Map();
  for (const r of e.results)
    if (r.state === "answered")
      for (const { known: n, block: o } of r.blocks) {
        if (!n || o.kind !== "metric") continue;
        const s = o.label.trim().toLowerCase(), i = t.get(s) ?? { label: o.label, readings: [] };
        i.readings.push({
          adapter: r.adapter,
          blockId: o.id,
          value: o.value,
          ...o.unit === void 0 ? {} : { unit: o.unit },
          coverage: r.answer.coverage.mode
        }), t.set(s, i);
      }
  return [...t.values()].filter((r) => new Set(r.readings.map((n) => n.adapter)).size > 1).map((r) => {
    const [n] = r.readings;
    return {
      ...r,
      agree: r.readings.every((o) => o.value === n?.value && o.unit === n?.unit)
    };
  });
}, al = (e) => e === 404 || e === 405 || e === 501, wi = async (e) => {
  try {
    const t = await e.json();
    if (typeof t.error == "string") return new Error(t.error);
  } catch {
  }
  return new Error(`${e.status} ${e.statusText}`.trim());
}, J4 = () => typeof crypto < "u" && "randomUUID" in crypto ? crypto.randomUUID() : `ask-${Date.now()}-${Math.random()}`, Q4 = (e) => {
  const t = { id: e.id, module: e.module, roles: e.roles }, r = [], n = (l, c, u) => {
    if (l !== void 0)
      try {
        return c(l);
      } catch (d) {
        r.push(d instanceof ou ? `${u}: ${d.issues.join("; ") || d.summary}` : `${u} is invalid`);
        return;
      }
  }, o = n(e.description, I4, "description"), s = n(e.status, R4, "status");
  o && (t.description = o), s && (t.status = s), e.freshness && (t.freshness = e.freshness), typeof e.runtime == "string" && (t.runtime = e.runtime);
  const i = [e.statusError, ...r].filter((l) => typeof l == "string");
  return i.length > 0 && (t.statusError = i.join(" ")), t;
}, eS = (e) => {
  const t = e;
  if (!t || !Array.isArray(t.adapters)) throw new Error("The server answered, but not with a list of adapters.");
  const r = t.adapters.filter((n) => typeof n == "object" && n !== null && typeof n.id == "string").map((n) => Q4({ ...n, module: String(n.module ?? ""), roles: Array.isArray(n.roles) ? n.roles : [] }));
  return {
    adapters: r,
    query: {
      defaultAdapters: Array.isArray(t.query?.defaultAdapters) ? t.query.defaultAdapters : r.map((n) => n.id),
      synthesis: t.query?.synthesis ?? !0
    },
    diagnostics: Array.isArray(t.diagnostics) ? t.diagnostics : []
  };
}, tS = (e = (t, r) => fetch(t, r)) => {
  let t;
  const r = async (n, o) => {
    const s = n.synthesis ? "/api/chat" : "/api/ask", i = new URLSearchParams({ q: n.question, limit: String(Hv) }), l = await e(`${s}?${i}`, { signal: n.signal ?? null });
    if (!l.ok) throw await wi(l);
    const c = await l.json();
    return n.synthesis ? il(Z4(c, o), "legacy-chat") : il(qv(c, o), "legacy-ask");
  };
  return {
    async ask(n) {
      const o = n.requestId ?? J4();
      if (t === !1) return r(n, o);
      const s = {
        requestId: o,
        question: n.question,
        synthesis: n.synthesis,
        ...n.adapters ? { adapters: n.adapters } : {},
        ...n.conversation ? { conversation: n.conversation } : {}
      }, i = await e("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
        signal: n.signal ?? null
      });
      if (al(i.status))
        return t = !1, r(n, o);
      if (t = !0, !i.ok) throw await wi(i);
      return il(await i.json(), "coordinator");
    },
    async cancel(n) {
      if (t === !0)
        try {
          await e(`/api/ask/${encodeURIComponent(n)}`, { method: "DELETE" });
        } catch {
        }
    },
    async resolveEvidence(n, o) {
      if (n.length === 0) return { state: "ready", references: [] };
      let s;
      try {
        s = await e("/api/evidence", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ references: n }),
          signal: o ?? null
        });
      } catch (l) {
        if (o?.aborted) throw l;
        return { state: "failed", message: l instanceof Error ? l.message : String(l) };
      }
      if (al(s.status)) return { state: "unavailable" };
      if (!s.ok) return { state: "failed", message: (await wi(s)).message };
      const i = await s.json();
      return Array.isArray(i.references) ? { state: "ready", references: i.references } : { state: "failed", message: "The server answered, but not with resolved references." };
    },
    async adapters(n) {
      let o;
      try {
        o = await e("/api/adapters", { signal: n ?? null });
      } catch (s) {
        if (n?.aborted) throw s;
        return { state: "failed", message: s instanceof Error ? s.message : String(s) };
      }
      if (al(o.status))
        return { state: "unavailable", message: "This docket does not report adapter status yet." };
      if (!o.ok) return { state: "failed", message: (await wi(o)).message };
      try {
        return { state: "ready", response: eS(await o.json()) };
      } catch (s) {
        return { state: "failed", message: s instanceof Error ? s.message : String(s) };
      }
    }
  };
}, Ts = (e, t, r = `${t}s`) => `${e} ${e === 1 ? t : r}`, Kl = (e, t = Date.now()) => {
  const r = Math.max(0, Math.round((t - Date.parse(e)) / 1e3));
  if (Number.isNaN(r)) return "at an unknown time";
  if (r < 45) return "just now";
  const n = Math.round(r / 60);
  if (n < 60) return `${Ts(n, "minute")} ago`;
  const o = Math.round(n / 60);
  return o < 24 ? `${Ts(o, "hour")} ago` : `${Ts(Math.round(o / 24), "day")} ago`;
}, rS = {
  validating: "Reading and checking the files…",
  projecting: "Projecting changes into the adapters…",
  recording: "Recording what each adapter holds…"
}, nS = (e) => {
  switch (e.state) {
    case "current":
      return "up to date";
    case "behind":
      return e.behind === void 0 ? "behind the files" : `${Ts(e.behind, "change")} behind`;
    case "unsynced":
      return "not synced yet";
    default:
      return "freshness unknown";
  }
}, oS = (e) => {
  if (!e.outOfDate) return null;
  const t = e.adapters.filter((s) => s.state === "behind"), r = e.adapters.filter((s) => s.state === "unsynced"), n = Math.max(0, ...t.map((s) => s.behind ?? 0));
  return `Projections out of date: ${[
    ...t.length > 0 ? [`files changed since the last sync (${Ts(n, "change")})`] : [],
    ...r.length > 0 ? [`${r.map((s) => s.id).join(", ")} ${r.length === 1 ? "has" : "have"} never been synced`] : []
  ].join("; ")}. Search and Ask answer from the projections, so they may miss recent edits.`;
}, sS = (e) => {
  if (e.state === "waiting") return "syncing…";
  const t = `${e.projected} projected, ${e.removed} removed, ${e.unchanged} unchanged`;
  return e.failed > 0 ? `${t}, ${e.failed} failed` : t;
}, iS = (e, t = Date.now()) => {
  if (e.state === "running") return e.stage ? rS[e.stage] : "Syncing…";
  const r = e.finishedAt ? ` ${Kl(e.finishedAt, t)}` : "";
  return e.state === "succeeded" ? e.results.length === 0 ? `Synced${r}: no adapter is enabled for projection.` : `Synced${r}.` : `Sync failed${r}.`;
}, ki = (e, t, r) => {
  const n = typeof t == "object" && t !== null && "error" in t && typeof t.error == "string" ? t.error : void 0;
  return e === 404 || e === 405 ? `This docket open cannot ${r}: it is older than this page. Restart it with the current docket.` : n !== void 0 ? n : e === 0 ? `Could not reach docket open to ${r}. Is it still running?` : `Could not ${r}: the server answered ${e}.`;
}, aS = 500, ll = async (e) => {
  try {
    return await e.json();
  } catch {
    return null;
  }
};
class lS {
  #e = /* @__PURE__ */ he(null);
  get status() {
    return a(this.#e);
  }
  set status(t) {
    Z(this.#e, t);
  }
  #t = /* @__PURE__ */ he(null);
  get failure() {
    return a(this.#t);
  }
  set failure(t) {
    Z(this.#t, t, !0);
  }
  #r = /* @__PURE__ */ he(!1);
  get starting() {
    return a(this.#r);
  }
  set starting(t) {
    Z(this.#r, t, !0);
  }
  #o = /* @__PURE__ */ T(() => this.starting || this.status?.run?.state === "running");
  get running() {
    return a(this.#o);
  }
  set running(t) {
    Z(this.#o, t);
  }
  #n = null;
  #s = 0;
  #i;
  #l;
  constructor(t = () => {
  }, r = (n, o) => fetch(n, o)) {
    this.#i = t, this.#l = r;
  }
  /** Reads the status again, and keeps reading it while a sync runs. */
  async refresh() {
    const t = ++this.#s, r = this.status?.run?.state === "running";
    try {
      const o = await this.#l("/api/sync"), s = await ll(o);
      if (t !== this.#s) return;
      if (!o.ok) throw new Error(ki(o.status, s, "read the sync status"));
      this.status = s, this.failure !== null && !this.starting && (this.failure = null);
    } catch (o) {
      if (t !== this.#s) return;
      this.failure = o instanceof Error ? o.message : String(o);
    }
    const n = this.status?.run?.state === "running";
    r && !n && this.#i(), this.#a(n);
  }
  /** Starts a sync of `adapters`, every adapter enabled for projection when null. */
  async start(t) {
    if (!this.running) {
      this.#s++, this.starting = !0, this.failure = null;
      try {
        const r = await this.#l("/api/session"), n = await ll(r);
        if (!r.ok) throw new Error(ki(r.status, n, "sync"));
        const o = await this.#l("/api/sync", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-docket-session": n.token
          },
          body: JSON.stringify(t === null ? {} : { adapters: t })
        }), s = await ll(o);
        if (!o.ok) throw new Error(ki(o.status, s, "sync"));
        this.status = s;
      } catch (r) {
        this.failure = r instanceof TypeError ? ki(0, null, "sync") : r instanceof Error ? r.message : String(r);
      } finally {
        this.#s++, this.starting = !1;
      }
      this.#a(this.status?.run?.state === "running");
    }
  }
  /** Stops following a running sync: the page is going away. */
  stop() {
    this.#n !== null && clearTimeout(this.#n), this.#n = null;
  }
  #a(t) {
    this.stop(), t && (this.#n = setTimeout(() => {
      this.refresh();
    }, aS));
  }
}
const uf = 9e4;
class cS {
  #e = /* @__PURE__ */ he("");
  get question() {
    return a(this.#e);
  }
  set question(t) {
    Z(this.#e, t, !0);
  }
  #t = /* @__PURE__ */ he(null);
  get adapters() {
    return a(this.#t);
  }
  set adapters(t) {
    Z(this.#t, t, !0);
  }
  #r = /* @__PURE__ */ he(!0);
  get synthesis() {
    return a(this.#r);
  }
  set synthesis(t) {
    Z(this.#r, t, !0);
  }
  #o = /* @__PURE__ */ he(null);
  get outcome() {
    return a(this.#o);
  }
  set outcome(t) {
    Z(this.#o, t);
  }
  #n = /* @__PURE__ */ he(null);
  get pending() {
    return a(this.#n);
  }
  set pending(t) {
    Z(this.#n, t, !0);
  }
  #s = /* @__PURE__ */ he(null);
  get failure() {
    return a(this.#s);
  }
  set failure(t) {
    Z(this.#s, t, !0);
  }
  #i = null;
  #l;
  constructor(t) {
    this.#l = t;
  }
  /** Asks the question, cancelling any question still out: a late answer never replaces a newer one. */
  async ask(t) {
    this.cancel();
    const r = new AbortController();
    this.#i = r;
    const n = typeof crypto < "u" && "randomUUID" in crypto ? crypto.randomUUID() : `ask-${Date.now()}`, o = this.adapters;
    this.pending = { requestId: n, question: t, adapters: o }, this.failure = null;
    const s = setTimeout(() => r.abort(new DOMException("timeout", "TimeoutError")), uf);
    try {
      const i = await this.#l.ask({
        question: t,
        requestId: n,
        synthesis: this.synthesis,
        signal: r.signal,
        ...o ? { adapters: o } : {}
      });
      if (this.pending?.requestId !== n) return;
      this.outcome = i;
    } catch (i) {
      if (this.pending?.requestId !== n) return;
      const l = r.signal.reason;
      this.failure = l instanceof DOMException && l.name === "TimeoutError" ? `No answer within ${uf / 1e3} seconds, so the question was cancelled.` : r.signal.aborted ? null : i instanceof Error ? i.message : String(i);
    } finally {
      clearTimeout(s), this.pending?.requestId === n && (this.pending = null, this.#i = null);
    }
  }
  cancel() {
    const t = this.pending;
    this.#i?.abort(), this.#i = null, this.pending = null, t && this.#l.cancel(t.requestId);
  }
  #a = /* @__PURE__ */ T(() => this.outcome ? Y4(this.outcome) : /* @__PURE__ */ new Map());
  get evidence() {
    return a(this.#a);
  }
  set evidence(t) {
    Z(this.#a, t);
  }
}
class uS {
  api;
  client;
  #e = /* @__PURE__ */ he(null);
  get graph() {
    return a(this.#e);
  }
  set graph(t) {
    Z(this.#e, t);
  }
  #t = /* @__PURE__ */ he(null);
  get loadError() {
    return a(this.#t);
  }
  set loadError(t) {
    Z(this.#t, t, !0);
  }
  #r = /* @__PURE__ */ he(!1);
  get loading() {
    return a(this.#r);
  }
  set loading(t) {
    Z(this.#r, t, !0);
  }
  #o = /* @__PURE__ */ he(null);
  get inspector() {
    return a(this.#o);
  }
  set inspector(t) {
    Z(this.#o, t);
  }
  #n = /* @__PURE__ */ he("inspector");
  get sideTab() {
    return a(this.#n);
  }
  set sideTab(t) {
    Z(this.#n, t, !0);
  }
  #s = /* @__PURE__ */ he(!0);
  get panelOpen() {
    return a(this.#s);
  }
  set panelOpen(t) {
    Z(this.#s, t, !0);
  }
  #i = /* @__PURE__ */ he(!0);
  get showFilters() {
    return a(this.#i);
  }
  set showFilters(t) {
    Z(this.#i, t, !0);
  }
  #l = /* @__PURE__ */ he("graph");
  get browseView() {
    return a(this.#l);
  }
  set browseView(t) {
    Z(this.#l, t, !0);
  }
  hiddenTypes = new Os();
  hiddenRels = new Os();
  #a = /* @__PURE__ */ he(!0);
  get showUnresolved() {
    return a(this.#a);
  }
  set showUnresolved(t) {
    Z(this.#a, t, !0);
  }
  #f = /* @__PURE__ */ he(null);
  get scope() {
    return a(this.#f);
  }
  set scope(t) {
    Z(this.#f, t);
  }
  #c = /* @__PURE__ */ he(!1);
  get scoped() {
    return a(this.#c);
  }
  set scoped(t) {
    Z(this.#c, t, !0);
  }
  #u = /* @__PURE__ */ he(null);
  get pickedEdge() {
    return a(this.#u);
  }
  set pickedEdge(t) {
    Z(this.#u, t);
  }
  #h = /* @__PURE__ */ he(null);
  get focus() {
    return a(this.#h);
  }
  set focus(t) {
    Z(this.#h, t);
  }
  #v = 0;
  ask;
  #d = /* @__PURE__ */ he(null);
  get adapters() {
    return a(this.#d);
  }
  set adapters(t) {
    Z(this.#d, t);
  }
  #g = null;
  #y = /* @__PURE__ */ he(Gt([]));
  get turns() {
    return a(this.#y);
  }
  set turns(t) {
    Z(this.#y, t, !0);
  }
  sync;
  #m = /* @__PURE__ */ he(!1);
  get syncOpen() {
    return a(this.#m);
  }
  set syncOpen(t) {
    Z(this.#m, t, !0);
  }
  constructor(t = Gp(), r = tS(t.fetch)) {
    this.api = t, this.client = r, this.ask = new cS(r), this.sync = new lS(
      () => {
        this.load(), this.adapters !== null && this.loadAdapters(!0);
      },
      t.fetch
    );
  }
  #b = /* @__PURE__ */ T(() => this.inspector?.kind === "exhibit" ? this.inspector.id : null);
  get selected() {
    return a(this.#b);
  }
  set selected(t) {
    Z(this.#b, t);
  }
  async load() {
    this.loading = !0;
    try {
      const t = await this.api.fetch("/api/graph"), r = await t.json();
      if (!t.ok || "error" in r) throw new Error("error" in r ? r.error : t.statusText);
      this.graph = r, this.loadError = null;
    } catch (t) {
      this.loadError = t instanceof Error ? t.message : String(t);
    } finally {
      this.loading = !1;
    }
  }
  /** Reads adapter status once; `refresh` reads it again. Viewing it never starts or pulls anything. */
  loadAdapters(t = !1) {
    return this.#g && !t ? this.#g : (this.#g = this.client.adapters().then((r) => {
      this.adapters = r;
    }), this.#g);
  }
  request(t) {
    this.#v += 1, this.focus = { ids: t, nonce: this.#v };
  }
  /** Make sure an entity is on the board before pointing at it. */
  reveal(t) {
    if (this.scoped && this.scope) {
      if (this.scope.ids.includes(t)) return;
      this.scoped = !1;
    }
    const r = this.graph?.entities.find((n) => n.id === t);
    r ? this.hiddenTypes.delete(r.type) : this.showUnresolved = !0;
  }
  /** Open an exhibit in the inspector. */
  select(t, r = {}) {
    this.pickedEdge = null, this.inspector = t ? { kind: "exhibit", id: t } : null, t && (this.sideTab = "inspector", this.panelOpen = !0, this.reveal(t), r.focus && this.request([t]));
  }
  /** Open one piece of an answer's evidence in the inspector. */
  inspectEvidence(t) {
    this.inspector = { kind: "evidence", evidenceId: t }, this.sideTab = "inspector", this.panelOpen = !0;
  }
  pickEdge(t) {
    this.scoped = !1, this.select(t.source), this.pickedEdge = t, this.reveal(t.target), this.hiddenRels.delete(t.rel), this.request([t.source, t.target]);
  }
  /** Put these exhibits, and only these, on the board. */
  showScope(t) {
    this.scope = t, this.scoped = !0, this.pickedEdge = null, this.browseView = "graph", t.ids.length > 0 && this.request(t.ids);
  }
  showEverything() {
    this.scoped = !1, this.request(this.selected ? [this.selected] : this.graph?.entities.map((t) => t.id) ?? []);
  }
}
const df = (e) => ({
  label: `the exhibits cited for “${e.query}”`,
  ids: [
    .../* @__PURE__ */ new Set([
      ...e.documents.map((t) => t.id),
      ...e.paths.flatMap((t) => t.nodes)
    ])
  ],
  links: e.paths.flatMap((t) => t.steps.map((r, n) => {
    const [o, s] = [t.nodes[n] ?? "", t.nodes[n + 1] ?? ""];
    return r.forward ? { source: o, rel: r.rel, target: s } : { source: s, rel: r.rel, target: o };
  }))
}), Gv = /* @__PURE__ */ Symbol("workspace"), dS = (e) => Ws(Gv, e), zr = () => go(Gv);
var fS = /* @__PURE__ */ z("<!> Check again", 1), hS = /* @__PURE__ */ z('<p class="text-muted-foreground font-serif italic">Reading adapter status…</p>'), pS = /* @__PURE__ */ z('not synced - run <code class="font-mono">docket sync</code>.', 1), vS = /* @__PURE__ */ z(' <code class="font-mono">docket sync</code>.', 1), gS = /* @__PURE__ */ z('<div class="flex flex-col gap-3 rounded-lg border border-dashed p-5 text-sm"><p class="flex items-center gap-2 font-medium"><!> </p> <p class="text-muted-foreground break-words"> </p> <p class="text-muted-foreground text-xs">Search still works through the configured projections. Their index, as the casebook reports it: <!></p></div>'), mS = /* @__PURE__ */ z(`<div class="flex flex-col gap-2 rounded-lg border border-dashed p-5 text-sm"><p class="flex items-center gap-2 font-medium"><!> No adapters configured</p> <p class="text-muted-foreground">Add an instance under <code class="font-mono">adapters:</code> in <code class="font-mono">.docket.yaml</code> - an installed package
          or a project-relative module - and enable it for <code class="font-mono">projection</code>, <code class="font-mono">query</code> or both.</p></div>`), bS = /* @__PURE__ */ z('<code class="font-mono"> </code> ', 1), xS = /* @__PURE__ */ z("<span> </span>"), yS = /* @__PURE__ */ z('<span class="text-muted-foreground rounded-full border border-dashed px-2 py-px text-[11px]">status unknown</span>'), _S = /* @__PURE__ */ z('<p class="text-sm break-words"> </p>'), wS = /* @__PURE__ */ z('<p class="text-destructive flex items-start gap-1.5 text-xs break-words"><!> </p>'), kS = /* @__PURE__ */ z('<dt class="text-muted-foreground">Checkpoint</dt> <dd class="font-mono"> </dd>', 1), SS = /* @__PURE__ */ z('<dt class="text-muted-foreground">Pending</dt> <dd class="tabular-nums"> </dd>', 1), $S = /* @__PURE__ */ z('<dt class="text-muted-foreground">Engine</dt> <dd class="font-mono"> </dd>', 1), zS = /* @__PURE__ */ z('<dt class="text-muted-foreground">Answers with</dt> <dd> </dd> <dt class="text-muted-foreground">Projects</dt> <dd> </dd>', 1), AS = /* @__PURE__ */ z('<dt class="text-muted-foreground">Runtime</dt> <dd><code class="font-mono"> </code> <span class="text-muted-foreground">- managed separately: <code class="font-mono"> </code></span></dd>', 1), ES = /* @__PURE__ */ z('<li class="bg-card flex min-w-0 flex-col gap-2.5 rounded-lg border p-4"><div class="flex flex-wrap items-center gap-2"><h2 class="font-mono text-sm font-semibold"> </h2> <!> <span class="ml-auto flex gap-1"></span></div> <p class="text-muted-foreground truncate font-mono text-xs"> </p> <!> <!> <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt class="text-muted-foreground">Freshness</dt> <dd> </dd> <!> <!> <!> <!> <!></dl></li>'), MS = /* @__PURE__ */ z("<p> </p>"), TS = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs"> <!> </p> <ul class="grid gap-3 md:grid-cols-2"></ul> <!>', 1), CS = /* @__PURE__ */ z(`<div class="h-full min-h-0 overflow-y-auto"><div class="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6"><header class="flex flex-wrap items-end gap-3"><div class="flex flex-col gap-1"><h1 class="font-serif text-xl font-semibold">Adapters</h1> <p class="text-muted-foreground text-sm">The memory engines configured in <code class="font-mono">.docket.yaml</code>: what each is enabled for, whether it can be reached,
          and how far its index lags the files. A healthy connection does not mean a fresh index.</p></div> <!></header> <!></div></div>`);
function OS(e, t) {
  Ee(t, !0);
  const r = zr();
  let n = /* @__PURE__ */ he(!1);
  os(() => {
    r.loadAdapters();
  });
  async function o() {
    Z(n, !0), await r.loadAdapters(!0), Z(n, !1);
  }
  const s = /* @__PURE__ */ T(() => r.adapters), i = {
    connected: "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
    ready: "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
    degraded: "border-amber-600/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    unavailable: "border-destructive/50 bg-destructive/10 text-destructive"
  }, l = (_) => {
    const k = _.freshness;
    return !k || k.state === "unknown" ? { label: "freshness unknown", tone: "text-muted-foreground" } : k.state === "current" ? {
      label: "up to date with the files",
      tone: "text-emerald-700 dark:text-emerald-400"
    } : { label: k.behind === void 0 ? "behind the files" : `${k.behind} ${k.behind === 1 ? "change" : "changes"} behind the files`, tone: "text-amber-700 dark:text-amber-400" };
  };
  var c = CS(), u = M(c), d = M(u), f = m(M(d), 2);
  ft(f, {
    variant: "outline",
    size: "sm",
    class: "ml-auto",
    onclick: o,
    get disabled() {
      return a(n);
    },
    children: (_, k) => {
      var S = fS(), b = re(S);
      {
        let $ = /* @__PURE__ */ T(() => a(n) ? "animate-spin" : "");
        Oc(b, {
          get class() {
            return a($);
          }
        });
      }
      x(_, S);
    },
    $$slots: { default: !0 }
  });
  var h = m(d, 2);
  {
    var p = (_) => {
      var k = hS();
      x(_, k);
    }, v = (_) => {
      var k = gS(), S = M(k), b = M(S);
      {
        let q = /* @__PURE__ */ T(() => a(s).state === "failed" ? "text-destructive" : "text-amber-600");
        or(b, {
          get class() {
            return `size-4 ${a(q) ?? ""}`;
          }
        });
      }
      var $ = m(b), E = m(S, 2), C = j(E, !0), w = m(E, 2), O = m(M(w));
      {
        var A = (q) => {
          var P = pS();
          x(q, P);
        }, R = (q) => {
          var P = vS(), H = re(P);
          L(() => N(H, `${t.graph.index.behind ?? ""} ${t.graph.index.behind === 1 ? "file" : "files"} behind - run `)), x(q, P);
        }, W = (q) => {
          var P = ct("up to date with the files.");
          x(q, P);
        };
        D(O, (q) => {
          t.graph.index.synced ? t.graph.index.behind > 0 ? q(R, 1) : q(W, -1) : q(A);
        });
      }
      L(() => {
        N($, ` ${a(s).state === "failed" ? "Could not read adapter status" : "Adapter status is not available"}`), N(C, a(s).message);
      }), x(_, k);
    }, g = (_) => {
      var k = mS(), S = M(k), b = M(S);
      qp(b, { class: "size-4" }), x(_, k);
    }, y = (_) => {
      const k = /* @__PURE__ */ T(() => a(s).response);
      var S = TS(), b = re(S), $ = M(b), E = m($);
      Ae(E, 18, () => a(k).query.defaultAdapters, (A) => A, (A, R, W) => {
        var q = bS(), P = re(q), H = j(P, !0), V = m(P, 1, !0);
        L(() => {
          N(H, R), N(V, a(W) < a(k).query.defaultAdapters.length - 1 ? ", " : "");
        }), x(A, q);
      });
      var C = m(E), w = m(b, 2);
      Ae(w, 21, () => a(k).adapters, (A) => A.id, (A, R) => {
        const W = /* @__PURE__ */ T(() => l(a(R)));
        var q = ES(), P = M(q), H = M(P), V = j(H, !0), Y = m(H, 2);
        {
          var oe = (ce) => {
            var xe = xS(), Se = j(xe, !0);
            L(() => {
              Ye(xe, 1, `rounded-full border px-2 py-px text-[11px] font-medium ${i[a(R).status.state] ?? "" ?? ""}`), N(Se, a(R).status.state);
            }), x(ce, xe);
          }, X = (ce) => {
            var xe = yS();
            x(ce, xe);
          };
          D(Y, (ce) => {
            a(R).status ? ce(oe) : ce(X, -1);
          });
        }
        var I = m(Y, 2);
        Ae(I, 20, () => a(R).roles, (ce) => ce, (ce, xe) => {
          Jt(ce, {
            variant: "secondary",
            class: "text-[10px]",
            children: (Se, ze) => {
              var de = ct();
              L(() => N(de, xe)), x(Se, de);
            },
            $$slots: { default: !0 }
          });
        });
        var te = m(P, 2), F = j(te), Q = m(te, 2);
        {
          var pe = (ce) => {
            var xe = _S(), Se = j(xe, !0);
            L(() => N(Se, a(R).status.message)), x(ce, xe);
          };
          D(Q, (ce) => {
            a(R).status?.message && ce(pe);
          });
        }
        var fe = m(Q, 2);
        {
          var G = (ce) => {
            var xe = wS(), Se = M(xe);
            or(Se, { class: "mt-px size-3.5 shrink-0" });
            var ze = m(Se, 1, !0);
            L(() => N(ze, a(R).statusError)), x(ce, xe);
          };
          D(fe, (ce) => {
            a(R).statusError && ce(G);
          });
        }
        var ve = m(fe, 2), ke = m(M(ve), 2), se = j(ke, !0), ye = m(ke, 2);
        {
          var U = (ce) => {
            var xe = kS(), Se = m(re(xe), 2), ze = j(Se);
            L(() => N(ze, `${a(R).status.checkpoint ?? ""}${a(R).freshness?.canonicalCheckpoint && a(R).freshness.canonicalCheckpoint !== a(R).status.checkpoint ? ` (files at ${a(R).freshness.canonicalCheckpoint})` : ""}`)), x(ce, xe);
          };
          D(ye, (ce) => {
            a(R).status?.checkpoint && ce(U);
          });
        }
        var ee = m(ye, 2);
        {
          var ue = (ce) => {
            var xe = SS(), Se = m(re(xe), 2), ze = j(Se);
            L(() => N(ze, `${a(R).status.pending ?? ""} ${a(R).status.pending === 1 ? "record" : "records"}`)), x(ce, xe);
          };
          D(ee, (ce) => {
            a(R).status?.pending !== void 0 && ce(ue);
          });
        }
        var me = m(ee, 2);
        {
          var Re = (ce) => {
            var xe = $S(), Se = m(re(xe), 2), ze = j(Se, !0);
            L(() => N(ze, a(R).status.engineVersion)), x(ce, xe);
          };
          D(me, (ce) => {
            a(R).status?.engineVersion && ce(Re);
          });
        }
        var Ve = m(me, 2);
        {
          var _e = (ce) => {
            var xe = zS(), Se = m(re(xe), 2), ze = j(Se, !0), de = m(Se, 4), we = j(de);
            L(
              (je, Fe) => {
                N(ze, je), N(we, `${Fe ?? ""} · rebuild ${a(R).description.rebuild ?? ""}`);
              },
              [
                () => a(R).description.resultKinds.join(", ") || "—",
                () => a(R).description.inputs.join(", ") || "—"
              ]
            ), x(ce, xe);
          };
          D(Ve, (ce) => {
            a(R).description && ce(_e);
          });
        }
        var Le = m(Ve, 2);
        {
          var De = (ce) => {
            var xe = AS(), Se = m(re(xe), 2), ze = M(Se), de = j(ze, !0), we = m(ze, 2), je = m(M(we)), Fe = j(je);
            L(() => {
              N(de, a(R).runtime), N(Fe, `docket runtime status ${a(R).runtime ?? ""}`);
            }), x(ce, xe);
          };
          D(Le, (ce) => {
            a(R).runtime && ce(De);
          });
        }
        L(() => {
          N(V, a(R).id), $e(te, "title", a(R).module), N(F, `${a(R).module ?? ""}${a(R).description ? ` · ${a(R).description.name} ${a(R).description.version}` : ""}`), Ye(ke, 1, Zo(a(W).tone)), N(se, a(W).label);
        }), x(A, q);
      });
      var O = m(w, 2);
      Ae(O, 17, () => a(k).diagnostics, xt, (A, R) => {
        var W = MS(), q = j(W, !0);
        L(() => {
          Ye(W, 1, `text-xs ${a(R).severity === "error" ? "text-destructive" : "text-muted-foreground"}`), N(q, a(R).message);
        }), x(A, W);
      }), L(() => {
        N($, `Ask uses ${a(k).query.defaultAdapters.length === 0 ? "no adapters" : ""}`), N(C, ` by default${a(k).query.synthesis ? ", and summarises with a model" : ", without a summary"}.`);
      }), x(_, S);
    };
    D(h, (_) => {
      a(s) === null ? _(p) : a(s).state === "unavailable" || a(s).state === "failed" ? _(v, 1) : a(s).response.adapters.length === 0 ? _(g, 2) : _(y, -1);
    });
  }
  x(e, c), Me();
}
var NS = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Kv(e, t) {
  let r = /* @__PURE__ */ K(t, NS);
  const n = {
    name: "arrow-left",
    size: 24,
    node: [
      ["path", { d: "m12 19-7-7 7-7" }],
      ["path", { d: "M19 12H5" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var PS = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Gn(e, t) {
  let r = /* @__PURE__ */ K(t, PS);
  const n = {
    name: "arrow-right",
    size: 24,
    node: [
      ["path", { d: "M5 12h14" }],
      ["path", { d: "m12 5 7 7-7 7" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var IS = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function iu(e, t) {
  let r = /* @__PURE__ */ K(t, IS);
  const n = {
    name: "check",
    size: 24,
    node: [["path", { d: "M20 6 9 17l-5-5" }]]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var RS = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Ys(e, t) {
  let r = /* @__PURE__ */ K(t, RS);
  const n = {
    name: "eye",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
        }
      ],
      ["circle", { cx: "12", cy: "12", r: "3" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var DS = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Yv(e, t) {
  let r = /* @__PURE__ */ K(t, DS);
  const n = {
    name: "scale",
    size: 24,
    node: [
      ["path", { d: "M12 3v18" }],
      ["path", { d: "m19 8 3 8a5 5 0 0 1-6 0zV7" }],
      ["path", { d: "M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1" }],
      ["path", { d: "m5 8 3 8a5 5 0 0 1-6 0zV7" }],
      ["path", { d: "M7 21h10" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var LS = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Xv(e, t) {
  let r = /* @__PURE__ */ K(t, LS);
  const n = {
    name: "search",
    size: 24,
    node: [
      ["path", { d: "m21 21-4.34-4.34" }],
      ["circle", { cx: "11", cy: "11", r: "8" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var jS = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function VS(e, t) {
  let r = /* @__PURE__ */ K(t, jS);
  const n = {
    name: "square",
    size: 24,
    node: [
      [
        "rect",
        { width: "18", height: "18", x: "3", y: "3", rx: "2" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var FS = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Xs(e, t) {
  let r = /* @__PURE__ */ K(t, FS);
  const n = {
    name: "x",
    size: 24,
    node: [
      ["path", { d: "M18 6 6 18" }],
      ["path", { d: "m6 6 12 12" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
function ZS(e) {
  return typeof e == "function";
}
function Js(e) {
  return e !== null && typeof e == "object";
}
const US = ["string", "number", "bigint", "boolean"];
function Yl(e) {
  return e == null || US.includes(typeof e) ? !0 : Array.isArray(e) ? e.every((t) => Yl(t)) : typeof e == "object" ? Object.getPrototypeOf(e) === Object.prototype : !1;
}
const Ko = /* @__PURE__ */ Symbol("box"), Aa = /* @__PURE__ */ Symbol("is-writable");
function Be(e, t) {
  const r = /* @__PURE__ */ T(e);
  return t ? {
    [Ko]: !0,
    [Aa]: !0,
    get current() {
      return a(r);
    },
    set current(n) {
      t(n);
    }
  } : {
    [Ko]: !0,
    get current() {
      return e();
    }
  };
}
function Qs(e) {
  return Js(e) && Ko in e;
}
function au(e) {
  return Qs(e) && Aa in e;
}
function BS(e) {
  return Qs(e) ? e : ZS(e) ? Be(e) : aa(e);
}
function WS(e) {
  return Object.entries(e).reduce(
    (t, [r, n]) => Qs(n) ? (au(n) ? Object.defineProperty(t, r, {
      get() {
        return n.current;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set(o) {
        n.current = o;
      }
    }) : Object.defineProperty(t, r, {
      get() {
        return n.current;
      }
    }), t) : Object.assign(t, { [r]: n }),
    {}
  );
}
function HS(e) {
  return au(e) ? {
    [Ko]: !0,
    get current() {
      return e.current;
    }
  } : e;
}
function aa(e) {
  let t = /* @__PURE__ */ he(Gt(e));
  return {
    [Ko]: !0,
    [Aa]: !0,
    get current() {
      return a(t);
    },
    set current(r) {
      Z(t, r, !0);
    }
  };
}
function zo(e) {
  let t = /* @__PURE__ */ he(Gt(e));
  return {
    [Ko]: !0,
    [Aa]: !0,
    get current() {
      return a(t);
    },
    set current(r) {
      Z(t, r, !0);
    }
  };
}
zo.from = BS;
zo.with = Be;
zo.flatten = WS;
zo.readonly = HS;
zo.isBox = Qs;
zo.isWritableBox = au;
function qS(...e) {
  return function(t) {
    for (const r of e)
      if (r) {
        if (t.defaultPrevented)
          return;
        typeof r == "function" ? r.call(this, t) : r.current?.call(this, t);
      }
  };
}
var ff = /\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, GS = /\n/g, KS = /^\s*/, YS = /^(\*?[-#/*\\\w]+(\[[0-9a-z_-]+\])?)\s*/, XS = /^:\s*/, JS = /^((?:'(?:\\'|.)*?'|"(?:\\"|.)*?"|\([^)]*?\)|[^};])+)/, QS = /^[;\s]*/, e5 = /^\s+|\s+$/g, t5 = `
`, hf = "/", pf = "*", lo = "", r5 = "comment", n5 = "declaration";
function o5(e, t) {
  if (typeof e != "string")
    throw new TypeError("First argument must be a string");
  if (!e) return [];
  t = t || {};
  var r = 1, n = 1;
  function o(v) {
    var g = v.match(GS);
    g && (r += g.length);
    var y = v.lastIndexOf(t5);
    n = ~y ? v.length - y : n + v.length;
  }
  function s() {
    var v = { line: r, column: n };
    return function(g) {
      return g.position = new i(v), u(), g;
    };
  }
  function i(v) {
    this.start = v, this.end = { line: r, column: n }, this.source = t.source;
  }
  i.prototype.content = e;
  function l(v) {
    var g = new Error(
      t.source + ":" + r + ":" + n + ": " + v
    );
    if (g.reason = v, g.filename = t.source, g.line = r, g.column = n, g.source = e, !t.silent) throw g;
  }
  function c(v) {
    var g = v.exec(e);
    if (g) {
      var y = g[0];
      return o(y), e = e.slice(y.length), g;
    }
  }
  function u() {
    c(KS);
  }
  function d(v) {
    var g;
    for (v = v || []; g = f(); )
      g !== !1 && v.push(g);
    return v;
  }
  function f() {
    var v = s();
    if (!(hf != e.charAt(0) || pf != e.charAt(1))) {
      for (var g = 2; lo != e.charAt(g) && (pf != e.charAt(g) || hf != e.charAt(g + 1)); )
        ++g;
      if (g += 2, lo === e.charAt(g - 1))
        return l("End of comment missing");
      var y = e.slice(2, g - 2);
      return n += 2, o(y), e = e.slice(g), n += 2, v({
        type: r5,
        comment: y
      });
    }
  }
  function h() {
    var v = s(), g = c(YS);
    if (g) {
      if (f(), !c(XS)) return l("property missing ':'");
      var y = c(JS), _ = v({
        type: n5,
        property: vf(g[0].replace(ff, lo)),
        value: y ? vf(y[0].replace(ff, lo)) : lo
      });
      return c(QS), _;
    }
  }
  function p() {
    var v = [];
    d(v);
    for (var g; g = h(); )
      g !== !1 && (v.push(g), d(v));
    return v;
  }
  return u(), p();
}
function vf(e) {
  return e ? e.replace(e5, lo) : lo;
}
function s5(e, t) {
  let r = null;
  if (!e || typeof e != "string")
    return r;
  const n = o5(e), o = typeof t == "function";
  return n.forEach((s) => {
    if (s.type !== "declaration")
      return;
    const { property: i, value: l } = s;
    o ? t(i, l, s) : l && (r = r || {}, r[i] = l);
  }), r;
}
const i5 = /\d/, a5 = ["-", "_", "/", "."];
function l5(e = "") {
  if (!i5.test(e))
    return e !== e.toLowerCase();
}
function c5(e) {
  const t = [];
  let r = "", n, o;
  for (const s of e) {
    const i = a5.includes(s);
    if (i === !0) {
      t.push(r), r = "", n = void 0;
      continue;
    }
    const l = l5(s);
    if (o === !1) {
      if (n === !1 && l === !0) {
        t.push(r), r = s, n = l;
        continue;
      }
      if (n === !0 && l === !1 && r.length > 1) {
        const c = r.at(-1);
        t.push(r.slice(0, Math.max(0, r.length - 1))), r = c + s, n = l;
        continue;
      }
    }
    r += s, n = l, o = i;
  }
  return t.push(r), t;
}
function Jv(e) {
  return e ? c5(e).map((t) => d5(t)).join("") : "";
}
function u5(e) {
  return f5(Jv(e || ""));
}
function d5(e) {
  return e ? e[0].toUpperCase() + e.slice(1) : "";
}
function f5(e) {
  return e ? e[0].toLowerCase() + e.slice(1) : "";
}
function Si(e) {
  if (!e)
    return {};
  const t = {};
  function r(n, o) {
    if (n.startsWith("-moz-") || n.startsWith("-webkit-") || n.startsWith("-ms-") || n.startsWith("-o-")) {
      t[Jv(n)] = o;
      return;
    }
    if (n.startsWith("--")) {
      t[n] = o;
      return;
    }
    t[u5(n)] = o;
  }
  return s5(e, r), t;
}
function Qv(...e) {
  return (...t) => {
    for (const r of e)
      typeof r == "function" && r(...t);
  };
}
function h5(e, t) {
  const r = RegExp(e, "g");
  return (n) => {
    if (typeof n != "string")
      throw new TypeError(`expected an argument of type string, but got ${typeof n}`);
    return n.match(r) ? n.replace(r, t) : n;
  };
}
const p5 = h5(/[A-Z]/, (e) => `-${e.toLowerCase()}`);
function v5(e) {
  if (!e || typeof e != "object" || Array.isArray(e))
    throw new TypeError(`expected an argument of type object, but got ${typeof e}`);
  return Object.keys(e).map((t) => `${p5(t)}: ${e[t]};`).join(`
`);
}
function eg(e = {}) {
  return v5(e).replace(`
`, " ");
}
const g5 = [
  "onabort",
  "onanimationcancel",
  "onanimationend",
  "onanimationiteration",
  "onanimationstart",
  "onauxclick",
  "onbeforeinput",
  "onbeforetoggle",
  "onblur",
  "oncancel",
  "oncanplay",
  "oncanplaythrough",
  "onchange",
  "onclick",
  "onclose",
  "oncompositionend",
  "oncompositionstart",
  "oncompositionupdate",
  "oncontextlost",
  "oncontextmenu",
  "oncontextrestored",
  "oncopy",
  "oncuechange",
  "oncut",
  "ondblclick",
  "ondrag",
  "ondragend",
  "ondragenter",
  "ondragleave",
  "ondragover",
  "ondragstart",
  "ondrop",
  "ondurationchange",
  "onemptied",
  "onended",
  "onerror",
  "onfocus",
  "onfocusin",
  "onfocusout",
  "onformdata",
  "ongotpointercapture",
  "oninput",
  "oninvalid",
  "onkeydown",
  "onkeypress",
  "onkeyup",
  "onload",
  "onloadeddata",
  "onloadedmetadata",
  "onloadstart",
  "onlostpointercapture",
  "onmousedown",
  "onmouseenter",
  "onmouseleave",
  "onmousemove",
  "onmouseout",
  "onmouseover",
  "onmouseup",
  "onpaste",
  "onpause",
  "onplay",
  "onplaying",
  "onpointercancel",
  "onpointerdown",
  "onpointerenter",
  "onpointerleave",
  "onpointermove",
  "onpointerout",
  "onpointerover",
  "onpointerup",
  "onprogress",
  "onratechange",
  "onreset",
  "onresize",
  "onscroll",
  "onscrollend",
  "onsecuritypolicyviolation",
  "onseeked",
  "onseeking",
  "onselect",
  "onselectionchange",
  "onselectstart",
  "onslotchange",
  "onstalled",
  "onsubmit",
  "onsuspend",
  "ontimeupdate",
  "ontoggle",
  "ontouchcancel",
  "ontouchend",
  "ontouchmove",
  "ontouchstart",
  "ontransitioncancel",
  "ontransitionend",
  "ontransitionrun",
  "ontransitionstart",
  "onvolumechange",
  "onwaiting",
  "onwebkitanimationend",
  "onwebkitanimationiteration",
  "onwebkitanimationstart",
  "onwebkittransitionend",
  "onwheel"
], m5 = new Set(g5);
function b5(e) {
  return m5.has(e);
}
function Dt(...e) {
  const t = { ...e[0] };
  for (let r = 1; r < e.length; r++) {
    const n = e[r];
    if (n) {
      for (const o of Object.keys(n)) {
        const s = t[o], i = n[o], l = typeof s == "function", c = typeof i == "function";
        if (l && b5(o)) {
          const u = s, d = i;
          t[o] = qS(u, d);
        } else if (l && c)
          t[o] = Qv(s, i);
        else if (o === "class") {
          const u = Yl(s), d = Yl(i);
          u && d ? t[o] = $s(s, i) : u ? t[o] = $s(s) : d && (t[o] = $s(i));
        } else if (o === "style") {
          const u = typeof s == "object", d = typeof i == "object", f = typeof s == "string", h = typeof i == "string";
          if (u && d)
            t[o] = { ...s, ...i };
          else if (u && h) {
            const p = Si(i);
            t[o] = { ...s, ...p };
          } else if (f && d) {
            const p = Si(s);
            t[o] = { ...p, ...i };
          } else if (f && h) {
            const p = Si(s), v = Si(i);
            t[o] = { ...p, ...v };
          } else u ? t[o] = s : d ? t[o] = i : f ? t[o] = s : h && (t[o] = i);
        } else
          t[o] = i !== void 0 ? i : s;
      }
      for (const o of Object.getOwnPropertySymbols(n)) {
        const s = t[o], i = n[o];
        t[o] = i !== void 0 ? i : s;
      }
    }
  }
  return typeof t.style == "object" && (t.style = eg(t.style).replaceAll(`
`, " ")), t.hidden === !1 && (t.hidden = void 0, delete t.hidden), t.disabled === !1 && (t.disabled = void 0, delete t.disabled), t;
}
const tg = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: "0",
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  borderWidth: "0",
  transform: "translateX(-100%)"
};
eg(tg);
const x5 = typeof window < "u" ? window : void 0;
function y5(e) {
  let t = e.activeElement;
  for (; t?.shadowRoot; ) {
    const r = t.shadowRoot.activeElement;
    if (r === t)
      break;
    t = r;
  }
  return t;
}
class _5 {
  #e;
  #t;
  constructor(t = {}) {
    const { window: r = x5, document: n = r?.document } = t;
    r !== void 0 && (this.#e = n, this.#t = Jh((o) => {
      const s = mo(r, "focusin", o), i = mo(r, "focusout", o);
      return () => {
        s(), i();
      };
    }));
  }
  get current() {
    return this.#t?.(), this.#e ? y5(this.#e) : null;
  }
}
new _5();
function w5(e, t) {
  return e;
}
class eo {
  #e;
  #t;
  /**
   * @param name The name of the context.
   * This is used for generating the context key and error messages.
   */
  constructor(t) {
    this.#e = t, this.#t = Symbol(t);
  }
  /**
   * The key used to get and set the context.
   *
   * It is not recommended to use this value directly.
   * Instead, use the methods provided by this class.
   */
  get key() {
    return this.#t;
  }
  /**
   * Checks whether this has been set in the context of a parent component.
   *
   * Must be called during component initialisation.
   */
  exists() {
    return Bm(this.#t);
  }
  /**
   * Retrieves the context that belongs to the closest parent component.
   *
   * Must be called during component initialisation.
   *
   * @throws An error if the context does not exist.
   */
  get() {
    const t = go(this.#t);
    if (t === void 0)
      throw new Error(`Context "${this.#e}" not found`);
    return t;
  }
  /**
   * Retrieves the context that belongs to the closest parent component,
   * or the given fallback value if the context does not exist.
   *
   * Must be called during component initialisation.
   */
  getOr(t) {
    const r = go(this.#t);
    return r === void 0 ? t : r;
  }
  /**
   * Associates the given value with the current component and returns it.
   *
   * Must be called during component initialisation.
   */
  set(t) {
    return Ws(this.#t, t);
  }
}
function rg(e, t) {
  let r = /* @__PURE__ */ he(null);
  const n = /* @__PURE__ */ T(() => w5(t));
  function o(...s) {
    if (a(r))
      a(r).timeout && clearTimeout(a(r).timeout);
    else {
      let i, l;
      const c = new Promise((u, d) => {
        i = u, l = d;
      });
      Z(r, { timeout: null, runner: null, promise: c, resolve: i, reject: l }, !0);
    }
    return a(r).runner = async () => {
      if (!a(r)) return;
      const i = a(r);
      Z(r, null);
      try {
        i.resolve(await e.apply(this, s));
      } catch (l) {
        i.reject(l);
      }
    }, a(r).timeout = setTimeout(a(r).runner, a(n)), a(r).promise;
  }
  return o.cancel = async () => {
    (!a(r) || a(r).timeout === null) && (await new Promise((s) => setTimeout(s, 0)), !a(r) || a(r).timeout === null) || (clearTimeout(a(r).timeout), a(r).reject("Cancelled"), Z(r, null));
  }, o.runScheduledNow = async () => {
    (!a(r) || !a(r).timeout) && (await new Promise((s) => setTimeout(s, 0)), !a(r) || !a(r).timeout) || (clearTimeout(a(r).timeout), a(r).timeout = null, await a(r).runner?.());
  }, Object.defineProperty(o, "pending", {
    enumerable: !0,
    get() {
      return !!a(r)?.timeout;
    }
  }), o;
}
function k5(e, t) {
  switch (e) {
    case "post":
      _t(t);
      break;
    case "pre":
      Ac(t);
      break;
  }
}
function ng(e, t, r, n = {}) {
  const { lazy: o = !1 } = n;
  let s = !o, i = Array.isArray(e) ? [] : void 0;
  k5(t, () => {
    const l = Array.isArray(e) ? e.map((u) => u()) : e();
    if (!s) {
      s = !0, i = l;
      return;
    }
    const c = Vt(() => r(l, i));
    return i = l, c;
  });
}
function Kn(e, t, r) {
  ng(e, "post", t, r);
}
function S5(e, t, r) {
  ng(e, "pre", t, r);
}
Kn.pre = S5;
class lu {
  #e = /* @__PURE__ */ he(!1);
  constructor() {
    _t(() => (Vt(() => Z(this.#e, !0)), () => {
      Z(this.#e, !1);
    }));
  }
  get current() {
    return a(this.#e);
  }
}
function og(e) {
  _t(() => () => {
    e();
  });
}
function $5(e) {
  Yi().then(e);
}
const z5 = 1, A5 = 9, E5 = 11;
function M5(e) {
  return Js(e) && e.nodeType === z5 && typeof e.nodeName == "string";
}
function sg(e) {
  return Js(e) && e.nodeType === A5;
}
function T5(e) {
  return Js(e) && e.constructor?.name === "VisualViewport";
}
function C5(e) {
  return Js(e) && e.nodeType !== void 0;
}
function O5(e) {
  return C5(e) && e.nodeType === E5 && "host" in e;
}
function N5(e) {
  return sg(e) ? e : T5(e) ? e.document : e?.ownerDocument ?? document;
}
function ig(e) {
  return O5(e) ? ig(e.host) : sg(e) ? e.defaultView ?? window : M5(e) ? e.ownerDocument?.defaultView ?? window : window;
}
function P5(e) {
  let t = e.activeElement;
  for (; t?.shadowRoot; ) {
    const r = t.shadowRoot.activeElement;
    if (r === t)
      break;
    t = r;
  }
  return t;
}
class I5 {
  element;
  #e = /* @__PURE__ */ T(() => this.element.current ? this.element.current.getRootNode() ?? document : document);
  get root() {
    return a(this.#e);
  }
  set root(t) {
    Z(this.#e, t);
  }
  constructor(t) {
    typeof t == "function" ? this.element = Be(t) : this.element = t;
  }
  getDocument = () => N5(this.root);
  getWindow = () => this.getDocument().defaultView ?? window;
  getActiveElement = () => P5(this.root);
  isActiveElement = (t) => t === this.getActiveElement();
  getElementById(t) {
    return this.root.getElementById(t);
  }
  querySelector = (t) => this.root ? this.root.querySelector(t) : null;
  querySelectorAll = (t) => this.root ? this.root.querySelectorAll(t) : [];
  setTimeout = (t, r) => this.getWindow().setTimeout(t, r);
  clearTimeout = (t) => this.getWindow().clearTimeout(t);
}
function pr(e, t) {
  return {
    [Cb()]: (r) => Qs(e) ? (e.current = r, Vt(() => t?.(r)), () => {
      "isConnected" in r && r.isConnected || (e.current = null, t?.(null));
    }) : (e(r), Vt(() => t?.(r)), () => {
      "isConnected" in r && r.isConnected || (e(null), t?.(null));
    })
  };
}
function Xl(e) {
  return e ? "true" : "false";
}
function R5(e) {
  return e ? "true" : void 0;
}
function la(e) {
  return e ? "" : void 0;
}
function ag(e) {
  return e ? !0 : void 0;
}
function D5(e, t) {
  return t ? "mixed" : e ? "true" : "false";
}
class L5 {
  #e;
  #t;
  attrs;
  constructor(t) {
    this.#e = t.getVariant ? t.getVariant() : null, this.#t = this.#e ? `data-${this.#e}-` : `data-${t.component}-`, this.getAttr = this.getAttr.bind(this), this.selector = this.selector.bind(this), this.attrs = Object.fromEntries(t.parts.map((r) => [r, this.getAttr(r)]));
  }
  getAttr(t, r) {
    return r ? `data-${r}-${t}` : `${this.#t}${t}`;
  }
  selector(t, r) {
    return `[${this.getAttr(t, r)}]`;
  }
}
function Ea(e) {
  const t = new L5(e);
  return {
    ...t.attrs,
    selector: t.selector,
    getAttr: t.getAttr
  };
}
const Jl = "ArrowDown", cu = "ArrowLeft", uu = "ArrowRight", Ql = "ArrowUp", j5 = "End", lg = "Enter", V5 = "Home", cg = " ";
function F5(e) {
  return window.getComputedStyle(e).getPropertyValue("direction");
}
function Z5(e = "ltr", t = "horizontal") {
  return {
    horizontal: e === "rtl" ? cu : uu,
    vertical: Jl
  }[t];
}
function U5(e = "ltr", t = "horizontal") {
  return {
    horizontal: e === "rtl" ? uu : cu,
    vertical: Ql
  }[t];
}
function B5(e = "ltr", t = "horizontal") {
  return ["ltr", "rtl"].includes(e) || (e = "ltr"), ["horizontal", "vertical"].includes(t) || (t = "horizontal"), {
    nextKey: Z5(e, t),
    prevKey: U5(e, t)
  };
}
function ug(e) {
  return e instanceof HTMLElement;
}
class W5 {
  #e;
  #t = zo(null);
  constructor(t) {
    this.#e = t;
  }
  getCandidateNodes() {
    return this.#e.rootNode.current ? this.#e.candidateSelector ? Array.from(this.#e.rootNode.current.querySelectorAll(this.#e.candidateSelector)) : this.#e.candidateAttr ? Array.from(this.#e.rootNode.current.querySelectorAll(`[${this.#e.candidateAttr}]:not([data-disabled])`)) : [] : [];
  }
  focusFirstCandidate() {
    const t = this.getCandidateNodes();
    t.length && t[0]?.focus();
  }
  handleKeydown(t, r, n = !1) {
    const o = this.#e.rootNode.current;
    if (!o || !t)
      return;
    const s = this.getCandidateNodes();
    if (!s.length)
      return;
    const i = s.indexOf(t), l = F5(o), { nextKey: c, prevKey: u } = B5(l, this.#e.orientation.current), d = this.#e.loop.current, f = {
      [c]: i + 1,
      [u]: i - 1,
      [V5]: 0,
      [j5]: s.length - 1
    };
    if (n) {
      const v = c === Jl ? uu : Jl, g = u === Ql ? cu : Ql;
      f[v] = i + 1, f[g] = i - 1;
    }
    let h = f[r.key];
    if (h === void 0)
      return;
    r.preventDefault(), h < 0 && d ? h = s.length - 1 : h === s.length && d && (h = 0);
    const p = s[h];
    if (p)
      return p.focus(), this.#t.current = p.id, this.#e.onCandidateFocus?.(p), p;
  }
  getTabIndex(t) {
    const r = this.getCandidateNodes(), n = this.#t.current !== null;
    return t && !n && r[0] === t ? (this.#t.current = t.id, 0) : t?.id === this.#t.current ? 0 : -1;
  }
  setCurrentTabStopId(t) {
    this.#t.current = t;
  }
  focusCurrentTabStop() {
    const t = this.#t.current;
    if (!t)
      return;
    const r = this.#e.rootNode.current?.querySelector(`#${t}`);
    !r || !ug(r) || r.focus();
  }
}
class H5 {
  #e;
  #t = null;
  #r = null;
  #o = 0;
  constructor(t) {
    this.#e = t, og(() => this.#n());
  }
  #n() {
    this.#t !== null && (window.cancelAnimationFrame(this.#t), this.#t = null), this.#r?.disconnect(), this.#r = null, this.#o++;
  }
  run(t) {
    this.#n();
    const r = this.#e.ref.current;
    if (!r)
      return;
    if (typeof r.getAnimations != "function") {
      this.#s(t);
      return;
    }
    const n = this.#o, o = () => {
      n === this.#o && this.#s(t);
    }, s = () => {
      if (n !== this.#o)
        return;
      const l = r.getAnimations();
      if (l.length === 0) {
        o();
        return;
      }
      Promise.all(l.map((c) => c.finished)).then(() => {
        o();
      }).catch(() => {
        if (n !== this.#o)
          return;
        if (r.getAnimations().some((d) => d.pending || d.playState !== "finished")) {
          s();
          return;
        }
        o();
      });
    }, i = () => {
      this.#t = window.requestAnimationFrame(() => {
        this.#t = null, s();
      });
    };
    if (!this.#e.afterTick.current) {
      i();
      return;
    }
    this.#t = window.requestAnimationFrame(() => {
      this.#t = null;
      const l = "data-starting-style";
      if (!r.hasAttribute(l)) {
        i();
        return;
      }
      this.#r = new MutationObserver(() => {
        n === this.#o && (r.hasAttribute(l) || (this.#r?.disconnect(), this.#r = null, i()));
      }), this.#r.observe(r, {
        attributes: !0,
        attributeFilter: [l]
      });
    });
  }
  #s(t) {
    const r = () => {
      t();
    };
    this.#e.afterTick ? $5(r) : r();
  }
}
function q5() {
}
function Ur(e, t) {
  return `bits-${e}`;
}
globalThis.bitsIdCounter ??= { current: 0 };
function G5(e = "bits") {
  return globalThis.bitsIdCounter.current++, `${e}-${globalThis.bitsIdCounter.current}`;
}
const K5 = Ea({
  component: "checkbox",
  parts: ["root", "group", "group-label", "input"]
}), Y5 = new eo("Checkbox.Group"), dg = new eo("Checkbox.Root");
class du {
  static create(t, r = null) {
    return dg.set(new du(t, r));
  }
  opts;
  group;
  #e = /* @__PURE__ */ T(() => this.group && this.group.opts.name.current ? this.group.opts.name.current : this.opts.name.current);
  get trueName() {
    return a(this.#e);
  }
  set trueName(t) {
    Z(this.#e, t);
  }
  #t = /* @__PURE__ */ T(() => this.group && this.group.opts.required.current ? !0 : this.opts.required.current);
  get trueRequired() {
    return a(this.#t);
  }
  set trueRequired(t) {
    Z(this.#t, t);
  }
  #r = /* @__PURE__ */ T(() => this.group && this.group.opts.disabled.current ? !0 : this.opts.disabled.current);
  get trueDisabled() {
    return a(this.#r);
  }
  set trueDisabled(t) {
    Z(this.#r, t);
  }
  #o = /* @__PURE__ */ T(() => this.group && this.group.opts.readonly.current ? !0 : this.opts.readonly.current);
  get trueReadonly() {
    return a(this.#o);
  }
  set trueReadonly(t) {
    Z(this.#o, t);
  }
  attachment;
  constructor(t, r) {
    this.opts = t, this.group = r, this.attachment = pr(this.opts.ref), this.onkeydown = this.onkeydown.bind(this), this.onclick = this.onclick.bind(this), Kn.pre(
      [
        () => Zm(this.group?.opts.value.current),
        () => this.opts.value.current
      ],
      ([n, o]) => {
        !n || !o || (this.opts.checked.current = n.includes(o));
      }
    ), Kn.pre(() => this.opts.checked.current, (n) => {
      this.group && (n ? this.group?.addValue(this.opts.value.current) : this.group?.removeValue(this.opts.value.current));
    });
  }
  onkeydown(t) {
    if (!(this.trueDisabled || this.trueReadonly)) {
      if (t.key === lg) {
        t.preventDefault(), this.opts.type.current === "submit" && t.currentTarget.closest("form")?.requestSubmit();
        return;
      }
      t.key === cg && (t.preventDefault(), this.#n());
    }
  }
  #n() {
    this.opts.indeterminate.current ? (this.opts.indeterminate.current = !1, this.opts.checked.current = !0) : this.opts.checked.current = !this.opts.checked.current;
  }
  onclick(t) {
    if (!(this.trueDisabled || this.trueReadonly)) {
      if (this.opts.type.current === "submit") {
        this.#n();
        return;
      }
      t.preventDefault(), this.#n();
    }
  }
  #s = /* @__PURE__ */ T(() => ({
    checked: this.opts.checked.current,
    indeterminate: this.opts.indeterminate.current
  }));
  get snippetProps() {
    return a(this.#s);
  }
  set snippetProps(t) {
    Z(this.#s, t);
  }
  #i = /* @__PURE__ */ T(() => ({
    id: this.opts.id.current,
    role: "checkbox",
    type: this.opts.type.current,
    disabled: this.trueDisabled,
    "aria-checked": D5(this.opts.checked.current, this.opts.indeterminate.current),
    "aria-required": Xl(this.trueRequired),
    "aria-readonly": Xl(this.trueReadonly),
    "data-disabled": la(this.trueDisabled),
    "data-readonly": la(this.trueReadonly),
    "data-state": X5(this.opts.checked.current, this.opts.indeterminate.current),
    [K5.root]: "",
    onclick: this.onclick,
    onkeydown: this.onkeydown,
    ...this.attachment
  }));
  get props() {
    return a(this.#i);
  }
  set props(t) {
    Z(this.#i, t);
  }
}
class fu {
  static create() {
    return new fu(dg.get());
  }
  root;
  #e = /* @__PURE__ */ T(() => this.root.group ? !!(this.root.opts.value.current !== void 0 && this.root.group.opts.value.current.includes(this.root.opts.value.current)) : this.root.opts.checked.current);
  get trueChecked() {
    return a(this.#e);
  }
  set trueChecked(t) {
    Z(this.#e, t);
  }
  #t = /* @__PURE__ */ T(() => !!this.root.trueName);
  get shouldRender() {
    return a(this.#t);
  }
  set shouldRender(t) {
    Z(this.#t, t);
  }
  constructor(t) {
    this.root = t, this.onfocus = this.onfocus.bind(this);
  }
  onfocus(t) {
    ug(this.root.opts.ref.current) && this.root.opts.ref.current.focus();
  }
  #r = /* @__PURE__ */ T(() => ({
    type: "checkbox",
    checked: this.root.opts.checked.current === !0,
    disabled: this.root.trueDisabled,
    required: this.root.trueRequired,
    name: this.root.trueName,
    form: this.root.opts.form.current,
    value: this.root.opts.value.current,
    readonly: this.root.trueReadonly,
    onfocus: this.onfocus
  }));
  get props() {
    return a(this.#r);
  }
  set props(t) {
    Z(this.#r, t);
  }
}
function X5(e, t) {
  return t ? "indeterminate" : e ? "checked" : "unchecked";
}
Vm();
var J5 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "value"]), gf = /* @__PURE__ */ z("<input/>");
function Q5(e, t) {
  Ee(t, !0);
  let r = be(t, "value", 15), n = /* @__PURE__ */ K(t, J5);
  const o = /* @__PURE__ */ T(() => Dt(n, {
    "aria-hidden": "true",
    tabindex: -1,
    style: { ...tg, position: "absolute", top: "0", left: "0" }
  }));
  var s = Ze(), i = re(s);
  {
    var l = (u) => {
      var d = gf();
      Et(d, () => ({ ...a(o), value: r() }), void 0, void 0, void 0, void 0, !0), x(u, d);
    }, c = (u) => {
      var d = gf();
      Et(d, () => ({ ...a(o) }), void 0, void 0, void 0, void 0, !0), Uo(d, r), x(u, d);
    };
    D(i, (u) => {
      a(o).type === "checkbox" ? u(l) : u(c, -1);
    });
  }
  x(e, s), Me();
}
function e$(e, t) {
  Ee(t, !1);
  const r = fu.create();
  Gb();
  var n = Ze(), o = re(n);
  {
    var s = (i) => {
      Q5(i, J(() => r.props));
    };
    D(o, (i) => {
      r.shouldRender && i(s);
    });
  }
  x(e, n), Me();
}
var t$ = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "checked",
  "ref",
  "onCheckedChange",
  "children",
  "disabled",
  "required",
  "name",
  "form",
  "value",
  "id",
  "indeterminate",
  "onIndeterminateChange",
  "child",
  "type",
  "readonly"
]), r$ = /* @__PURE__ */ z("<button><!></button>"), n$ = /* @__PURE__ */ z("<!> <!>", 1);
function o$(e, t) {
  const r = Zr();
  Ee(t, !0);
  let n = be(t, "checked", 15, !1), o = be(t, "ref", 15, null), s = be(t, "disabled", 3, !1), i = be(t, "required", 3, !1), l = be(t, "name", 3, void 0), c = be(t, "form", 3, void 0), u = be(t, "value", 3, "on"), d = be(t, "id", 19, () => Ur(r)), f = be(t, "indeterminate", 15, !1), h = be(t, "type", 3, "button"), p = /* @__PURE__ */ K(t, t$);
  const v = Y5.getOr(null);
  v && u() && (v.opts.value.current.includes(u()) ? n(!0) : n(!1)), Kn.pre(() => u(), () => {
    v && u() && (v.opts.value.current.includes(u()) ? n(!0) : n(!1));
  });
  const g = du.create(
    {
      checked: Be(() => n(), (E) => {
        n(E), t.onCheckedChange?.(E);
      }),
      disabled: Be(() => s() ?? !1),
      required: Be(() => i()),
      name: Be(() => l()),
      form: Be(() => c()),
      value: Be(() => u()),
      id: Be(() => d()),
      ref: Be(() => o(), (E) => o(E)),
      indeterminate: Be(() => f(), (E) => {
        f(E), t.onIndeterminateChange?.(E);
      }),
      type: Be(() => h()),
      readonly: Be(() => !!t.readonly)
    },
    v
  ), y = /* @__PURE__ */ T(() => Dt({ ...p }, g.props));
  var _ = n$(), k = re(_);
  {
    var S = (E) => {
      var C = Ze(), w = re(C);
      {
        let O = /* @__PURE__ */ T(() => ({ props: a(y), ...g.snippetProps }));
        vt(w, () => t.child, () => a(O));
      }
      x(E, C);
    }, b = (E) => {
      var C = r$();
      Et(C, () => ({ ...a(y) }));
      var w = M(C);
      vt(w, () => t.children ?? dt, () => g.snippetProps), x(E, C);
    };
    D(k, (E) => {
      t.child ? E(S) : E(b, -1);
    });
  }
  var $ = m(k, 2);
  e$($, {}), x(e, _), Me();
}
const s$ = Ea({ component: "separator", parts: ["root"] });
class hu {
  static create(t) {
    return new hu(t);
  }
  opts;
  attachment;
  constructor(t) {
    this.opts = t, this.attachment = pr(t.ref);
  }
  #e = /* @__PURE__ */ T(() => ({
    id: this.opts.id.current,
    role: this.opts.decorative.current ? "none" : "separator",
    "aria-orientation": this.opts.orientation.current,
    "aria-hidden": R5(this.opts.decorative.current),
    "data-orientation": this.opts.orientation.current,
    [s$.root]: "",
    ...this.attachment
  }));
  get props() {
    return a(this.#e);
  }
  set props(t) {
    Z(this.#e, t);
  }
}
var i$ = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "id",
  "ref",
  "child",
  "children",
  "decorative",
  "orientation"
]), a$ = /* @__PURE__ */ z("<div><!></div>");
function l$(e, t) {
  const r = Zr();
  Ee(t, !0);
  let n = be(t, "id", 19, () => Ur(r)), o = be(t, "ref", 15, null), s = be(t, "decorative", 3, !1), i = be(t, "orientation", 3, "horizontal"), l = /* @__PURE__ */ K(t, i$);
  const c = hu.create({
    ref: Be(() => o(), (v) => o(v)),
    id: Be(() => n()),
    decorative: Be(() => s()),
    orientation: Be(() => i())
  }), u = /* @__PURE__ */ T(() => Dt(l, c.props));
  var d = Ze(), f = re(d);
  {
    var h = (v) => {
      var g = Ze(), y = re(g);
      vt(y, () => t.child, () => ({ props: a(u) })), x(v, g);
    }, p = (v) => {
      var g = a$();
      Et(g, () => ({ ...a(u) }));
      var y = M(g);
      vt(y, () => t.children ?? dt), x(v, g);
    };
    D(f, (v) => {
      t.child ? v(h) : v(p, -1);
    });
  }
  x(e, d), Me();
}
let ec = null;
const ys = /* @__PURE__ */ new WeakMap();
function c$() {
  return ec ??= new ResizeObserver((e) => {
    for (const t of e) {
      const r = ys.get(t.target);
      if (r)
        for (const n of [...r]) n();
    }
  }), ec;
}
function u$(e, t) {
  let r = ys.get(e);
  return r === void 0 ? (r = /* @__PURE__ */ new Set(), ys.set(e, r), r.add(t), c$().observe(e)) : (r.add(t), t()), () => {
    const n = ys.get(e);
    n && (n.delete(t), !n.size && (ys.delete(e), ec?.unobserve(e)));
  };
}
class Yo {
  #e;
  #t;
  constructor(t, r) {
    this.#e = t, this.#t = r, this.handler = this.handler.bind(this), _t(this.handler);
  }
  handler() {
    let t = 0;
    const r = this.#e();
    if (!r) return;
    const n = u$(r, () => {
      cancelAnimationFrame(t), t = window.requestAnimationFrame(this.#t);
    });
    return () => {
      window.cancelAnimationFrame(t), n();
    };
  }
}
class d$ {
  opts;
  present;
  #e;
  #t = /* @__PURE__ */ he(!1);
  #r = !1;
  #o = /* @__PURE__ */ he(void 0);
  #n = null;
  constructor(t) {
    this.opts = t, this.present = this.opts.open, Z(this.#t, t.open.current, !0), this.#e = new H5({ ref: this.opts.ref, afterTick: this.opts.open }), og(() => this.#i()), Kn(() => this.present.current, (r) => {
      if (!this.#r) {
        this.#r = !0;
        return;
      }
      this.#i(), r && Z(this.#t, !0), Z(this.#o, r ? "starting" : "ending", !0), r && (this.#n = window.requestAnimationFrame(() => {
        this.#n = null, this.present.current && Z(this.#o, void 0);
      })), this.#e.run(() => {
        r === this.present.current && (r || Z(this.#t, !1), Z(this.#o, void 0));
      });
    });
  }
  #s = /* @__PURE__ */ T(() => a(this.#t));
  get isPresent() {
    return a(this.#s);
  }
  set isPresent(t) {
    Z(this.#s, t);
  }
  get transitionStatus() {
    return a(this.#o);
  }
  #i() {
    this.#n !== null && (window.cancelAnimationFrame(this.#n), this.#n = null);
  }
}
function Ma(e, t) {
  Ee(t, !0);
  const r = new d$({ open: Be(() => t.open), ref: t.ref });
  var n = Ze(), o = re(n);
  {
    var s = (i) => {
      var l = Ze(), c = re(l);
      vt(c, () => t.presence ?? dt, () => ({
        present: r.isPresent,
        transitionStatus: r.transitionStatus
      })), x(i, l);
    };
    D(o, (i) => {
      (t.forceMount || t.open || r.isPresent) && i(s);
    });
  }
  x(e, n), Me();
}
function f$(e, t, r) {
  return Math.min(r, Math.max(t, e));
}
class h$ {
  state;
  #e;
  constructor(t, r) {
    this.state = aa(t), this.#e = r, this.dispatch = this.dispatch.bind(this);
  }
  #t(t) {
    return this.#e[this.state.current][t] ?? this.state.current;
  }
  dispatch(t) {
    this.state.current = this.#t(t);
  }
}
const ei = Ea({
  component: "scroll-area",
  parts: ["root", "viewport", "corner", "thumb", "scrollbar"]
}), ti = new eo("ScrollArea.Root"), ri = new eo("ScrollArea.Scrollbar"), Ta = new eo("ScrollArea.ScrollbarVisible"), pu = new eo("ScrollArea.ScrollbarAxis"), fg = new eo("ScrollArea.ScrollbarShared");
class vu {
  static create(t) {
    return ti.set(new vu(t));
  }
  opts;
  attachment;
  #e = /* @__PURE__ */ he(null);
  get scrollAreaNode() {
    return a(this.#e);
  }
  set scrollAreaNode(t) {
    Z(this.#e, t, !0);
  }
  #t = /* @__PURE__ */ he(null);
  get viewportNode() {
    return a(this.#t);
  }
  set viewportNode(t) {
    Z(this.#t, t, !0);
  }
  #r = /* @__PURE__ */ he(null);
  get contentNode() {
    return a(this.#r);
  }
  set contentNode(t) {
    Z(this.#r, t, !0);
  }
  #o = /* @__PURE__ */ he(null);
  get scrollbarXNode() {
    return a(this.#o);
  }
  set scrollbarXNode(t) {
    Z(this.#o, t, !0);
  }
  #n = /* @__PURE__ */ he(null);
  get scrollbarYNode() {
    return a(this.#n);
  }
  set scrollbarYNode(t) {
    Z(this.#n, t, !0);
  }
  #s = /* @__PURE__ */ he(0);
  get cornerWidth() {
    return a(this.#s);
  }
  set cornerWidth(t) {
    Z(this.#s, t, !0);
  }
  #i = /* @__PURE__ */ he(0);
  get cornerHeight() {
    return a(this.#i);
  }
  set cornerHeight(t) {
    Z(this.#i, t, !0);
  }
  #l = /* @__PURE__ */ he(!1);
  get scrollbarXEnabled() {
    return a(this.#l);
  }
  set scrollbarXEnabled(t) {
    Z(this.#l, t, !0);
  }
  #a = /* @__PURE__ */ he(!1);
  get scrollbarYEnabled() {
    return a(this.#a);
  }
  set scrollbarYEnabled(t) {
    Z(this.#a, t, !0);
  }
  domContext;
  constructor(t) {
    this.opts = t, this.attachment = pr(t.ref, (r) => this.scrollAreaNode = r), this.domContext = new I5(t.ref);
  }
  #f = /* @__PURE__ */ T(() => ({
    id: this.opts.id.current,
    dir: this.opts.dir.current,
    style: {
      position: "relative",
      "--bits-scroll-area-corner-height": `${this.cornerHeight}px`,
      "--bits-scroll-area-corner-width": `${this.cornerWidth}px`
    },
    [ei.root]: "",
    ...this.attachment
  }));
  get props() {
    return a(this.#f);
  }
  set props(t) {
    Z(this.#f, t);
  }
}
class gu {
  static create(t) {
    return new gu(t, ti.get());
  }
  opts;
  root;
  attachment;
  #e = aa(G5());
  #t = aa(null);
  contentAttachment = pr(this.#t, (t) => this.root.contentNode = t);
  constructor(t, r) {
    this.opts = t, this.root = r, this.attachment = pr(t.ref, (n) => this.root.viewportNode = n);
  }
  #r = /* @__PURE__ */ T(() => ({
    id: this.opts.id.current,
    style: {
      overflowX: this.root.scrollbarXEnabled ? "scroll" : "hidden",
      overflowY: this.root.scrollbarYEnabled ? "scroll" : "hidden"
    },
    [ei.viewport]: "",
    ...this.attachment
  }));
  get props() {
    return a(this.#r);
  }
  set props(t) {
    Z(this.#r, t);
  }
  #o = /* @__PURE__ */ T(() => ({
    id: this.#e.current,
    "data-scroll-area-content": "",
    style: {
      minWidth: this.root.scrollbarXEnabled ? "fit-content" : void 0
    },
    ...this.contentAttachment
  }));
  get contentProps() {
    return a(this.#o);
  }
  set contentProps(t) {
    Z(this.#o, t);
  }
}
class mu {
  static create(t) {
    return ri.set(new mu(t, ti.get()));
  }
  opts;
  root;
  #e = /* @__PURE__ */ T(() => this.opts.orientation.current === "horizontal");
  get isHorizontal() {
    return a(this.#e);
  }
  set isHorizontal(t) {
    Z(this.#e, t);
  }
  #t = /* @__PURE__ */ he(!1);
  get hasThumb() {
    return a(this.#t);
  }
  set hasThumb(t) {
    Z(this.#t, t, !0);
  }
  constructor(t, r) {
    this.opts = t, this.root = r, Kn(() => this.isHorizontal, (n) => n ? (this.root.scrollbarXEnabled = !0, () => {
      this.root.scrollbarXEnabled = !1;
    }) : (this.root.scrollbarYEnabled = !0, () => {
      this.root.scrollbarYEnabled = !1;
    }));
  }
}
class bu {
  static create() {
    return new bu(ri.get());
  }
  scrollbar;
  root;
  #e = /* @__PURE__ */ he(!1);
  get isVisible() {
    return a(this.#e);
  }
  set isVisible(t) {
    Z(this.#e, t, !0);
  }
  constructor(t) {
    this.scrollbar = t, this.root = t.root, _t(() => {
      const r = this.root.scrollAreaNode, n = this.root.opts.scrollHideDelay.current;
      let o = 0;
      if (!r) return;
      const s = () => {
        this.root.domContext.clearTimeout(o), Vt(() => this.isVisible = !0);
      }, i = () => {
        o && this.root.domContext.clearTimeout(o), o = this.root.domContext.setTimeout(
          () => {
            Vt(() => {
              this.scrollbar.hasThumb = !1, this.isVisible = !1;
            });
          },
          n
        );
      }, l = Qv(mo(r, "pointerenter", s), mo(r, "pointerleave", i));
      return () => {
        this.root.domContext.getWindow().clearTimeout(o), l();
      };
    });
  }
  #t = /* @__PURE__ */ T(() => ({ "data-state": this.isVisible ? "visible" : "hidden" }));
  get props() {
    return a(this.#t);
  }
  set props(t) {
    Z(this.#t, t);
  }
}
class xu {
  static create() {
    return new xu(ri.get());
  }
  scrollbar;
  root;
  machine = new h$("hidden", {
    hidden: { SCROLL: "scrolling" },
    scrolling: { SCROLL_END: "idle", POINTER_ENTER: "interacting" },
    interacting: { SCROLL: "interacting", POINTER_LEAVE: "idle" },
    idle: {
      HIDE: "hidden",
      SCROLL: "scrolling",
      POINTER_ENTER: "interacting"
    }
  });
  #e = /* @__PURE__ */ T(() => this.machine.state.current === "hidden");
  get isHidden() {
    return a(this.#e);
  }
  set isHidden(t) {
    Z(this.#e, t);
  }
  constructor(t) {
    this.scrollbar = t, this.root = t.root;
    const r = rg(() => this.machine.dispatch("SCROLL_END"), 100);
    _t(() => {
      const n = this.machine.state.current, o = this.root.opts.scrollHideDelay.current;
      if (n === "idle") {
        const s = this.root.domContext.setTimeout(() => this.machine.dispatch("HIDE"), o);
        return () => this.root.domContext.clearTimeout(s);
      }
    }), _t(() => {
      const n = this.root.viewportNode;
      if (!n) return;
      const o = this.scrollbar.isHorizontal ? "scrollLeft" : "scrollTop";
      let s = n[o];
      return mo(n, "scroll", () => {
        const c = n[o];
        s !== c && (this.machine.dispatch("SCROLL"), r()), s = c;
      });
    }), this.onpointerenter = this.onpointerenter.bind(this), this.onpointerleave = this.onpointerleave.bind(this);
  }
  onpointerenter(t) {
    this.machine.dispatch("POINTER_ENTER");
  }
  onpointerleave(t) {
    this.machine.dispatch("POINTER_LEAVE");
  }
  #t = /* @__PURE__ */ T(() => ({
    "data-state": this.machine.state.current === "hidden" ? "hidden" : "visible",
    onpointerenter: this.onpointerenter,
    onpointerleave: this.onpointerleave
  }));
  get props() {
    return a(this.#t);
  }
  set props(t) {
    Z(this.#t, t);
  }
}
class Ca {
  static create() {
    return new Ca(ri.get());
  }
  scrollbar;
  root;
  #e = /* @__PURE__ */ he(!1);
  get isVisible() {
    return a(this.#e);
  }
  set isVisible(t) {
    Z(this.#e, t, !0);
  }
  constructor(t) {
    this.scrollbar = t, this.root = t.root;
    const r = () => {
      const n = this.root.viewportNode;
      if (!n) return;
      const o = n.offsetWidth < n.scrollWidth, s = n.offsetHeight < n.scrollHeight;
      this.isVisible = this.scrollbar.isHorizontal ? o : s;
    };
    new Yo(() => this.root.viewportNode, r), new Yo(() => this.root.contentNode, r);
  }
  #t = /* @__PURE__ */ T(() => ({ "data-state": this.isVisible ? "visible" : "hidden" }));
  get props() {
    return a(this.#t);
  }
  set props(t) {
    Z(this.#t, t);
  }
}
class yu {
  static create() {
    return Ta.set(new yu(ri.get()));
  }
  scrollbar;
  root;
  #e = /* @__PURE__ */ he(null);
  get thumbNode() {
    return a(this.#e);
  }
  set thumbNode(t) {
    Z(this.#e, t, !0);
  }
  #t = /* @__PURE__ */ he(0);
  get pointerOffset() {
    return a(this.#t);
  }
  set pointerOffset(t) {
    Z(this.#t, t, !0);
  }
  #r = /* @__PURE__ */ he({
    content: 0,
    viewport: 0,
    scrollbar: { size: 0, paddingStart: 0, paddingEnd: 0 }
  });
  get sizes() {
    return a(this.#r);
  }
  set sizes(t) {
    Z(this.#r, t);
  }
  #o = /* @__PURE__ */ T(() => hg(this.sizes.viewport, this.sizes.content));
  get thumbRatio() {
    return a(this.#o);
  }
  set thumbRatio(t) {
    Z(this.#o, t);
  }
  #n = /* @__PURE__ */ T(() => this.thumbRatio > 0 && this.thumbRatio < 1);
  get hasThumb() {
    return a(this.#n);
  }
  set hasThumb(t) {
    Z(this.#n, t);
  }
  #s = /* @__PURE__ */ he("");
  get prevTransformStyle() {
    return a(this.#s);
  }
  set prevTransformStyle(t) {
    Z(this.#s, t, !0);
  }
  constructor(t) {
    this.scrollbar = t, this.root = t.root, _t(() => {
      this.scrollbar.hasThumb = this.hasThumb;
    }), _t(() => {
      !this.scrollbar.hasThumb && this.thumbNode && (this.prevTransformStyle = this.thumbNode.style.transform);
    });
  }
  setSizes(t) {
    this.sizes = t;
  }
  getScrollPosition(t, r) {
    return p$({
      pointerPos: t,
      pointerOffset: this.pointerOffset,
      sizes: this.sizes,
      dir: r
    });
  }
  onThumbPointerUp() {
    this.pointerOffset = 0;
  }
  onThumbPointerDown(t) {
    this.pointerOffset = t;
  }
  xOnThumbPositionChange() {
    if (!(this.root.viewportNode && this.thumbNode)) return;
    const t = this.root.viewportNode.scrollLeft, n = `translate3d(${mf({
      scrollPos: t,
      sizes: this.sizes,
      dir: this.root.opts.dir.current
    })}px, 0, 0)`;
    this.thumbNode.style.transform = n, this.prevTransformStyle = n;
  }
  xOnWheelScroll(t) {
    this.root.viewportNode && (this.root.viewportNode.scrollLeft = t);
  }
  xOnDragScroll(t) {
    this.root.viewportNode && (this.root.viewportNode.scrollLeft = this.getScrollPosition(t, this.root.opts.dir.current));
  }
  yOnThumbPositionChange() {
    if (!(this.root.viewportNode && this.thumbNode)) return;
    const t = this.root.viewportNode.scrollTop, n = `translate3d(0, ${mf({ scrollPos: t, sizes: this.sizes })}px, 0)`;
    this.thumbNode.style.transform = n, this.prevTransformStyle = n;
  }
  yOnWheelScroll(t) {
    this.root.viewportNode && (this.root.viewportNode.scrollTop = t);
  }
  yOnDragScroll(t) {
    this.root.viewportNode && (this.root.viewportNode.scrollTop = this.getScrollPosition(t, this.root.opts.dir.current));
  }
}
class _u {
  static create(t) {
    return pu.set(new _u(t, Ta.get()));
  }
  opts;
  scrollbarVis;
  root;
  scrollbar;
  attachment;
  #e = /* @__PURE__ */ he();
  get computedStyle() {
    return a(this.#e);
  }
  set computedStyle(t) {
    Z(this.#e, t, !0);
  }
  constructor(t, r) {
    this.opts = t, this.scrollbarVis = r, this.root = r.root, this.scrollbar = r.scrollbar, this.attachment = pr(this.scrollbar.opts.ref, (n) => this.root.scrollbarXNode = n), _t(() => {
      this.scrollbar.opts.ref.current && this.opts.mounted.current && (this.computedStyle = getComputedStyle(this.scrollbar.opts.ref.current));
    }), _t(() => {
      this.onResize();
    });
  }
  onThumbPointerDown = (t) => {
    this.scrollbarVis.onThumbPointerDown(t.x);
  };
  onDragScroll = (t) => {
    this.scrollbarVis.xOnDragScroll(t.x);
  };
  onThumbPointerUp = () => {
    this.scrollbarVis.onThumbPointerUp();
  };
  onThumbPositionChange = () => {
    this.scrollbarVis.xOnThumbPositionChange();
  };
  onWheelScroll = (t, r) => {
    if (!this.root.viewportNode) return;
    const n = this.root.viewportNode.scrollLeft + t.deltaX;
    this.scrollbarVis.xOnWheelScroll(n), vg(n, r) && t.preventDefault();
  };
  onResize = () => {
    this.scrollbar.opts.ref.current && this.root.viewportNode && this.computedStyle && this.scrollbarVis.setSizes({
      content: this.root.viewportNode.scrollWidth,
      viewport: this.root.viewportNode.offsetWidth,
      scrollbar: {
        size: this.scrollbar.opts.ref.current.clientWidth,
        paddingStart: ca(this.computedStyle.paddingLeft),
        paddingEnd: ca(this.computedStyle.paddingRight)
      }
    });
  };
  #t = /* @__PURE__ */ T(() => Oa(this.scrollbarVis.sizes));
  get thumbSize() {
    return a(this.#t);
  }
  set thumbSize(t) {
    Z(this.#t, t);
  }
  #r = /* @__PURE__ */ T(() => ({
    id: this.scrollbar.opts.id.current,
    "data-orientation": "horizontal",
    style: {
      bottom: 0,
      left: this.root.opts.dir.current === "rtl" ? "var(--bits-scroll-area-corner-width)" : 0,
      right: this.root.opts.dir.current === "ltr" ? "var(--bits-scroll-area-corner-width)" : 0,
      "--bits-scroll-area-thumb-width": `${this.thumbSize}px`
    },
    ...this.attachment
  }));
  get props() {
    return a(this.#r);
  }
  set props(t) {
    Z(this.#r, t);
  }
}
class wu {
  static create(t) {
    return pu.set(new wu(t, Ta.get()));
  }
  opts;
  scrollbarVis;
  root;
  scrollbar;
  attachment;
  #e = /* @__PURE__ */ he();
  get computedStyle() {
    return a(this.#e);
  }
  set computedStyle(t) {
    Z(this.#e, t, !0);
  }
  constructor(t, r) {
    this.opts = t, this.scrollbarVis = r, this.root = r.root, this.scrollbar = r.scrollbar, this.attachment = pr(this.scrollbar.opts.ref, (n) => this.root.scrollbarYNode = n), _t(() => {
      this.scrollbar.opts.ref.current && this.opts.mounted.current && (this.computedStyle = getComputedStyle(this.scrollbar.opts.ref.current));
    }), _t(() => {
      this.onResize();
    }), this.onThumbPointerDown = this.onThumbPointerDown.bind(this), this.onDragScroll = this.onDragScroll.bind(this), this.onThumbPointerUp = this.onThumbPointerUp.bind(this), this.onThumbPositionChange = this.onThumbPositionChange.bind(this), this.onWheelScroll = this.onWheelScroll.bind(this), this.onResize = this.onResize.bind(this);
  }
  onThumbPointerDown(t) {
    this.scrollbarVis.onThumbPointerDown(t.y);
  }
  onDragScroll(t) {
    this.scrollbarVis.yOnDragScroll(t.y);
  }
  onThumbPointerUp() {
    this.scrollbarVis.onThumbPointerUp();
  }
  onThumbPositionChange() {
    this.scrollbarVis.yOnThumbPositionChange();
  }
  onWheelScroll(t, r) {
    if (!this.root.viewportNode) return;
    const n = this.root.viewportNode.scrollTop + t.deltaY;
    this.scrollbarVis.yOnWheelScroll(n), vg(n, r) && t.preventDefault();
  }
  onResize() {
    this.scrollbar.opts.ref.current && this.root.viewportNode && this.computedStyle && this.scrollbarVis.setSizes({
      content: this.root.viewportNode.scrollHeight,
      viewport: this.root.viewportNode.offsetHeight,
      scrollbar: {
        size: this.scrollbar.opts.ref.current.clientHeight,
        paddingStart: ca(this.computedStyle.paddingTop),
        paddingEnd: ca(this.computedStyle.paddingBottom)
      }
    });
  }
  #t = /* @__PURE__ */ T(() => Oa(this.scrollbarVis.sizes));
  get thumbSize() {
    return a(this.#t);
  }
  set thumbSize(t) {
    Z(this.#t, t);
  }
  #r = /* @__PURE__ */ T(() => ({
    id: this.scrollbar.opts.id.current,
    "data-orientation": "vertical",
    style: {
      top: 0,
      right: this.root.opts.dir.current === "ltr" ? 0 : void 0,
      left: this.root.opts.dir.current === "rtl" ? 0 : void 0,
      bottom: "var(--bits-scroll-area-corner-height)",
      "--bits-scroll-area-thumb-height": `${this.thumbSize}px`
    },
    ...this.attachment
  }));
  get props() {
    return a(this.#r);
  }
  set props(t) {
    Z(this.#r, t);
  }
}
class ku {
  static create() {
    return fg.set(new ku(pu.get()));
  }
  scrollbarState;
  root;
  scrollbarVis;
  scrollbar;
  #e = /* @__PURE__ */ he(null);
  get rect() {
    return a(this.#e);
  }
  set rect(t) {
    Z(this.#e, t);
  }
  #t = /* @__PURE__ */ he("");
  get prevWebkitUserSelect() {
    return a(this.#t);
  }
  set prevWebkitUserSelect(t) {
    Z(this.#t, t, !0);
  }
  handleResize;
  handleThumbPositionChange;
  handleWheelScroll;
  handleThumbPointerDown;
  handleThumbPointerUp;
  #r = /* @__PURE__ */ T(() => this.scrollbarVis.sizes.content - this.scrollbarVis.sizes.viewport);
  get maxScrollPos() {
    return a(this.#r);
  }
  set maxScrollPos(t) {
    Z(this.#r, t);
  }
  constructor(t) {
    this.scrollbarState = t, this.root = t.root, this.scrollbarVis = t.scrollbarVis, this.scrollbar = t.scrollbarVis.scrollbar, this.handleResize = () => this.scrollbarState.onResize(), this.handleThumbPositionChange = this.scrollbarState.onThumbPositionChange, this.handleWheelScroll = this.scrollbarState.onWheelScroll, this.handleThumbPointerDown = this.scrollbarState.onThumbPointerDown, this.handleThumbPointerUp = this.scrollbarState.onThumbPointerUp, _t(() => {
      const r = this.maxScrollPos, n = this.scrollbar.opts.ref.current;
      this.root.viewportNode;
      const o = (i) => {
        const l = i.target;
        n?.contains(l) && this.handleWheelScroll(i, r);
      };
      return mo(this.root.domContext.getDocument(), "wheel", o, { passive: !1 });
    }), Ac(() => {
      this.scrollbarVis.sizes, Vt(() => this.handleThumbPositionChange());
    }), new Yo(() => this.scrollbar.opts.ref.current, this.handleResize), new Yo(() => this.root.contentNode, this.handleResize), this.onpointerdown = this.onpointerdown.bind(this), this.onpointermove = this.onpointermove.bind(this), this.onpointerup = this.onpointerup.bind(this), this.onlostpointercapture = this.onlostpointercapture.bind(this);
  }
  handleDragScroll(t) {
    if (!this.rect) return;
    const r = t.clientX - this.rect.left, n = t.clientY - this.rect.top;
    this.scrollbarState.onDragScroll({ x: r, y: n });
  }
  #o() {
    this.rect !== null && (this.root.domContext.getDocument().body.style.webkitUserSelect = this.prevWebkitUserSelect, this.root.viewportNode && (this.root.viewportNode.style.scrollBehavior = ""), this.rect = null);
  }
  onpointerdown(t) {
    if (t.button !== 0) return;
    t.target.setPointerCapture(t.pointerId), this.rect = this.scrollbar.opts.ref.current?.getBoundingClientRect() ?? null, this.prevWebkitUserSelect = this.root.domContext.getDocument().body.style.webkitUserSelect, this.root.domContext.getDocument().body.style.webkitUserSelect = "none", this.root.viewportNode && (this.root.viewportNode.style.scrollBehavior = "auto"), this.handleDragScroll(t);
  }
  onpointermove(t) {
    this.handleDragScroll(t);
  }
  onpointerup(t) {
    const r = t.target;
    r.hasPointerCapture(t.pointerId) && r.releasePointerCapture(t.pointerId), this.#o();
  }
  onlostpointercapture(t) {
    this.#o();
  }
  #n = /* @__PURE__ */ T(() => Dt({
    ...this.scrollbarState.props,
    style: { position: "absolute", ...this.scrollbarState.props.style },
    [ei.scrollbar]: "",
    onpointerdown: this.onpointerdown,
    onpointermove: this.onpointermove,
    onpointerup: this.onpointerup,
    onlostpointercapture: this.onlostpointercapture
  }));
  get props() {
    return a(this.#n);
  }
  set props(t) {
    Z(this.#n, t);
  }
}
class Su {
  static create(t) {
    return new Su(t, fg.get());
  }
  opts;
  scrollbarState;
  attachment;
  #e;
  #t = /* @__PURE__ */ he();
  #r = rg(
    () => {
      a(this.#t) && (a(this.#t)(), Z(this.#t, void 0));
    },
    100
  );
  constructor(t, r) {
    this.opts = t, this.scrollbarState = r, this.#e = r.root, this.attachment = pr(this.opts.ref, (n) => this.scrollbarState.scrollbarVis.thumbNode = n), _t(() => {
      const n = this.#e.viewportNode;
      if (!n) return;
      const o = () => {
        if (this.#r(), !a(this.#t)) {
          const i = v$(n, this.scrollbarState.handleThumbPositionChange);
          Z(this.#t, i, !0), this.scrollbarState.handleThumbPositionChange();
        }
      };
      return Vt(() => this.scrollbarState.handleThumbPositionChange()), mo(n, "scroll", o);
    }), this.onpointerdowncapture = this.onpointerdowncapture.bind(this), this.onpointerup = this.onpointerup.bind(this);
  }
  onpointerdowncapture(t) {
    const r = t.target;
    if (!r) return;
    const n = r.getBoundingClientRect(), o = t.clientX - n.left, s = t.clientY - n.top;
    this.scrollbarState.handleThumbPointerDown({ x: o, y: s });
  }
  onpointerup(t) {
    this.scrollbarState.handleThumbPointerUp();
  }
  #o = /* @__PURE__ */ T(() => ({
    id: this.opts.id.current,
    "data-state": this.scrollbarState.scrollbarVis.hasThumb ? "visible" : "hidden",
    style: {
      width: "var(--bits-scroll-area-thumb-width)",
      height: "var(--bits-scroll-area-thumb-height)",
      transform: this.scrollbarState.scrollbarVis.prevTransformStyle
    },
    onpointerdowncapture: this.onpointerdowncapture,
    onpointerup: this.onpointerup,
    [ei.thumb]: "",
    ...this.attachment
  }));
  get props() {
    return a(this.#o);
  }
  set props(t) {
    Z(this.#o, t);
  }
}
class $u {
  static create(t) {
    return new $u(t, ti.get());
  }
  opts;
  root;
  attachment;
  #e = /* @__PURE__ */ he(0);
  #t = /* @__PURE__ */ he(0);
  #r = /* @__PURE__ */ T(() => !!(a(this.#e) && a(this.#t)));
  get hasSize() {
    return a(this.#r);
  }
  set hasSize(t) {
    Z(this.#r, t);
  }
  constructor(t, r) {
    this.opts = t, this.root = r, this.attachment = pr(this.opts.ref), new Yo(() => this.root.scrollbarXNode, () => {
      const n = this.root.scrollbarXNode?.offsetHeight || 0;
      this.root.cornerHeight = n, Z(this.#t, n, !0);
    }), new Yo(() => this.root.scrollbarYNode, () => {
      const n = this.root.scrollbarYNode?.offsetWidth || 0;
      this.root.cornerWidth = n, Z(this.#e, n, !0);
    });
  }
  #o = /* @__PURE__ */ T(() => ({
    id: this.opts.id.current,
    style: {
      width: a(this.#e),
      height: a(this.#t),
      position: "absolute",
      right: this.root.opts.dir.current === "ltr" ? 0 : void 0,
      left: this.root.opts.dir.current === "rtl" ? 0 : void 0,
      bottom: 0
    },
    [ei.corner]: "",
    ...this.attachment
  }));
  get props() {
    return a(this.#o);
  }
  set props(t) {
    Z(this.#o, t);
  }
}
function ca(e) {
  return e ? Number.parseInt(e, 10) : 0;
}
function hg(e, t) {
  const r = e / t;
  return Number.isNaN(r) ? 0 : r;
}
function Oa(e) {
  const t = hg(e.viewport, e.content), r = e.scrollbar.paddingStart + e.scrollbar.paddingEnd, n = (e.scrollbar.size - r) * t;
  return Math.max(n, 18);
}
function p$({ pointerPos: e, pointerOffset: t, sizes: r, dir: n = "ltr" }) {
  const o = Oa(r), s = o / 2, i = t || s, l = o - i, c = r.scrollbar.paddingStart + i, u = r.scrollbar.size - r.scrollbar.paddingEnd - l, d = r.content - r.viewport, f = n === "ltr" ? [0, d] : [d * -1, 0];
  return pg([c, u], f)(e);
}
function mf({ scrollPos: e, sizes: t, dir: r = "ltr" }) {
  const n = Oa(t), o = t.scrollbar.paddingStart + t.scrollbar.paddingEnd, s = t.scrollbar.size - o, i = t.content - t.viewport, l = s - n, c = r === "ltr" ? [0, i] : [i * -1, 0], u = f$(e, c[0], c[1]);
  return pg([0, i], [0, l])(u);
}
function pg(e, t) {
  return (r) => {
    if (e[0] === e[1] || t[0] === t[1]) return t[0];
    const n = (t[1] - t[0]) / (e[1] - e[0]);
    return t[0] + n * (r - e[0]);
  };
}
function vg(e, t) {
  return e > 0 && e < t;
}
function v$(e, t) {
  let r = { left: e.scrollLeft, top: e.scrollTop }, n = 0;
  const o = ig(e);
  return (function s() {
    const i = { left: e.scrollLeft, top: e.scrollTop }, l = r.left !== i.left, c = r.top !== i.top;
    (l || c) && t(), r = i, n = o.requestAnimationFrame(s);
  })(), () => o.cancelAnimationFrame(n);
}
var g$ = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "id",
  "type",
  "dir",
  "scrollHideDelay",
  "children",
  "child"
]), m$ = /* @__PURE__ */ z("<div><!></div>");
function b$(e, t) {
  const r = Zr();
  Ee(t, !0);
  let n = be(t, "ref", 15, null), o = be(t, "id", 19, () => Ur(r)), s = be(t, "type", 3, "hover"), i = be(t, "dir", 3, "ltr"), l = be(t, "scrollHideDelay", 3, 600), c = /* @__PURE__ */ K(t, g$);
  const u = vu.create({
    type: Be(() => s()),
    dir: Be(() => i()),
    scrollHideDelay: Be(() => l()),
    id: Be(() => o()),
    ref: Be(() => n(), (g) => n(g))
  }), d = /* @__PURE__ */ T(() => Dt(c, u.props));
  var f = Ze(), h = re(f);
  {
    var p = (g) => {
      var y = Ze(), _ = re(y);
      vt(_, () => t.child, () => ({ props: a(d) })), x(g, y);
    }, v = (g) => {
      var y = m$();
      Et(y, () => ({ ...a(d) }));
      var _ = M(y);
      vt(_, () => t.children ?? dt), x(g, y);
    };
    D(h, (g) => {
      t.child ? g(p) : g(v, -1);
    });
  }
  x(e, f), Me();
}
var x$ = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "ref", "id", "children"]), y$ = /* @__PURE__ */ z("<div><div><!></div></div>");
const _$ = {
  hash: "svelte-1cg1f0k",
  code: `
	/* Hide scrollbars cross browser and enable momentum scroll for touch devices */[data-scroll-area-viewport] {scrollbar-width:none !important;-ms-overflow-style:none !important;-webkit-overflow-scrolling:touch !important;}[data-scroll-area-viewport]::-webkit-scrollbar {display:none !important;}:where([data-scroll-area-viewport]) {display:flex;flex-direction:column;align-items:stretch;}:where([data-scroll-area-content]) {flex-grow:1;}`
};
function w$(e, t) {
  const r = Zr();
  Ee(t, !0), Db(e, _$);
  let n = be(t, "ref", 15, null), o = be(t, "id", 19, () => Ur(r)), s = /* @__PURE__ */ K(t, x$);
  const i = gu.create({
    id: Be(() => o()),
    ref: Be(() => n(), (h) => n(h))
  }), l = /* @__PURE__ */ T(() => Dt(s, i.props)), c = /* @__PURE__ */ T(() => Dt({}, i.contentProps));
  var u = y$();
  Et(u, () => ({ ...a(l) }));
  var d = M(u);
  Et(d, () => ({ ...a(c) }));
  var f = M(d);
  vt(f, () => t.children ?? dt), x(e, u), Me();
}
var k$ = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "child", "children"]), S$ = /* @__PURE__ */ z("<div><!></div>");
function gg(e, t) {
  Ee(t, !0);
  let r = /* @__PURE__ */ K(t, k$);
  const n = ku.create(), o = /* @__PURE__ */ T(() => Dt(r, n.props));
  var s = Ze(), i = re(s);
  {
    var l = (u) => {
      var d = Ze(), f = re(d);
      vt(f, () => t.child, () => ({ props: a(o) })), x(u, d);
    }, c = (u) => {
      var d = S$();
      Et(d, () => ({ ...a(o) }));
      var f = M(d);
      vt(f, () => t.children ?? dt), x(u, d);
    };
    D(i, (u) => {
      t.child ? u(l) : u(c, -1);
    });
  }
  x(e, s), Me();
}
var $$ = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function z$(e, t) {
  Ee(t, !0);
  let r = /* @__PURE__ */ K(t, $$);
  const n = new lu(), o = _u.create({ mounted: Be(() => n.current) }), s = /* @__PURE__ */ T(() => Dt(r, o.props));
  gg(e, J(() => a(s))), Me();
}
var A$ = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function E$(e, t) {
  Ee(t, !0);
  let r = /* @__PURE__ */ K(t, A$);
  const n = new lu(), o = wu.create({ mounted: Be(() => n.current) }), s = /* @__PURE__ */ T(() => Dt(r, o.props));
  gg(e, J(() => a(s))), Me();
}
var M$ = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Na(e, t) {
  Ee(t, !0);
  let r = /* @__PURE__ */ K(t, M$);
  const n = yu.create();
  var o = Ze(), s = re(o);
  {
    var i = (c) => {
      z$(c, J(() => r));
    }, l = (c) => {
      E$(c, J(() => r));
    };
    D(s, (c) => {
      n.scrollbar.opts.orientation.current === "horizontal" ? c(i) : c(l, -1);
    });
  }
  x(e, o), Me();
}
var T$ = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "forceMount"]);
function C$(e, t) {
  Ee(t, !0);
  let r = be(t, "forceMount", 3, !1), n = /* @__PURE__ */ K(t, T$);
  const o = Ca.create(), s = /* @__PURE__ */ T(() => Dt(n, o.props));
  {
    const i = (c) => {
      Na(c, J(() => a(s)));
    };
    let l = /* @__PURE__ */ T(() => r() || o.isVisible);
    Ma(e, {
      get open() {
        return a(l);
      },
      get ref() {
        return o.scrollbar.opts.ref;
      },
      presence: i,
      $$slots: { presence: !0 }
    });
  }
  Me();
}
var O$ = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "forceMount"]);
function N$(e, t) {
  Ee(t, !0);
  let r = be(t, "forceMount", 3, !1), n = /* @__PURE__ */ K(t, O$);
  const o = xu.create(), s = /* @__PURE__ */ T(() => Dt(n, o.props));
  {
    const i = (c) => {
      Na(c, J(() => a(s)));
    };
    let l = /* @__PURE__ */ T(() => r() || !o.isHidden);
    Ma(e, J(() => a(s), {
      get open() {
        return a(l);
      },
      get ref() {
        return o.scrollbar.opts.ref;
      },
      presence: i,
      $$slots: { presence: !0 }
    }));
  }
  Me();
}
var P$ = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "forceMount"]);
function I$(e, t) {
  Ee(t, !0);
  let r = be(t, "forceMount", 3, !1), n = /* @__PURE__ */ K(t, P$);
  const o = bu.create(), s = Ca.create(), i = /* @__PURE__ */ T(() => Dt(n, o.props, s.props, {
    "data-state": o.isVisible ? "visible" : "hidden"
  })), l = /* @__PURE__ */ T(() => r() || o.isVisible && s.isVisible);
  Ma(e, {
    get open() {
      return a(l);
    },
    get ref() {
      return s.scrollbar.opts.ref;
    },
    presence: (u) => {
      Na(u, J(() => a(i)));
    },
    $$slots: { presence: !0 }
  }), Me();
}
var R$ = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "id",
  "orientation"
]);
function D$(e, t) {
  const r = Zr();
  Ee(t, !0);
  let n = be(t, "ref", 15, null), o = be(t, "id", 19, () => Ur(r)), s = /* @__PURE__ */ K(t, R$);
  const i = mu.create({
    orientation: Be(() => t.orientation),
    id: Be(() => o()),
    ref: Be(() => n(), (v) => n(v))
  }), l = /* @__PURE__ */ T(() => i.root.opts.type.current);
  var c = Ze(), u = re(c);
  {
    var d = (v) => {
      I$(v, J(() => s, {
        get id() {
          return o();
        }
      }));
    }, f = (v) => {
      N$(v, J(() => s, {
        get id() {
          return o();
        }
      }));
    }, h = (v) => {
      C$(v, J(() => s, {
        get id() {
          return o();
        }
      }));
    }, p = (v) => {
      Na(v, J(() => s, {
        get id() {
          return o();
        }
      }));
    };
    D(u, (v) => {
      a(l) === "hover" ? v(d) : a(l) === "scroll" ? v(f, 1) : a(l) === "auto" ? v(h, 2) : a(l) === "always" && v(p, 3);
    });
  }
  x(e, c), Me();
}
var L$ = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "id",
  "child",
  "children",
  "present"
]), j$ = /* @__PURE__ */ z("<div><!></div>");
function V$(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = /* @__PURE__ */ K(t, L$);
  const o = new lu(), s = Su.create({
    id: Be(() => t.id),
    ref: Be(() => r(), (f) => r(f)),
    mounted: Be(() => o.current)
  }), i = /* @__PURE__ */ T(() => Dt(n, s.props, { style: { hidden: !t.present } }));
  var l = Ze(), c = re(l);
  {
    var u = (f) => {
      var h = Ze(), p = re(h);
      vt(p, () => t.child, () => ({ props: a(i) })), x(f, h);
    }, d = (f) => {
      var h = j$();
      Et(h, () => ({ ...a(i) }));
      var p = M(h);
      vt(p, () => t.children ?? dt), x(f, h);
    };
    D(c, (f) => {
      t.child ? f(u) : f(d, -1);
    });
  }
  x(e, l), Me();
}
var F$ = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "id", "ref", "forceMount"]);
function Z$(e, t) {
  const r = Zr();
  Ee(t, !0);
  let n = be(t, "id", 19, () => Ur(r)), o = be(t, "ref", 15, null), s = be(t, "forceMount", 3, !1), i = /* @__PURE__ */ K(t, F$);
  const l = Ta.get();
  {
    const c = (d, f) => {
      let h = () => (f?.()).present;
      V$(d, J(() => i, {
        get id() {
          return n();
        },
        get present() {
          return h();
        },
        get ref() {
          return o();
        },
        set ref(p) {
          o(p);
        }
      }));
    };
    let u = /* @__PURE__ */ T(() => s() || l.hasThumb);
    Ma(e, {
      get open() {
        return a(u);
      },
      get ref() {
        return l.scrollbar.opts.ref;
      },
      presence: c,
      $$slots: { presence: !0 }
    });
  }
  Me();
}
var U$ = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "id",
  "children",
  "child"
]), B$ = /* @__PURE__ */ z("<div><!></div>");
function W$(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = /* @__PURE__ */ K(t, U$);
  const o = $u.create({
    id: Be(() => t.id),
    ref: Be(() => r(), (d) => r(d))
  }), s = /* @__PURE__ */ T(() => Dt(n, o.props));
  var i = Ze(), l = re(i);
  {
    var c = (d) => {
      var f = Ze(), h = re(f);
      vt(h, () => t.child, () => ({ props: a(s) })), x(d, f);
    }, u = (d) => {
      var f = B$();
      Et(f, () => ({ ...a(s) }));
      var h = M(f);
      vt(h, () => t.children ?? dt), x(d, f);
    };
    D(l, (d) => {
      t.child ? d(c) : d(u, -1);
    });
  }
  x(e, i), Me();
}
var H$ = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "ref", "id"]);
function q$(e, t) {
  const r = Zr();
  Ee(t, !0);
  let n = be(t, "ref", 15, null), o = be(t, "id", 19, () => Ur(r)), s = /* @__PURE__ */ K(t, H$);
  const i = ti.get(), l = /* @__PURE__ */ T(() => !!(i.scrollbarXNode && i.scrollbarYNode)), c = /* @__PURE__ */ T(() => i.opts.type.current !== "scroll" && a(l));
  var u = Ze(), d = re(u);
  {
    var f = (h) => {
      W$(h, J(() => s, {
        get id() {
          return o();
        },
        get ref() {
          return n();
        },
        set ref(p) {
          n(p);
        }
      }));
    };
    D(d, (h) => {
      a(c) && h(f);
    });
  }
  x(e, u), Me();
}
const Is = Ea({
  component: "tabs",
  parts: ["root", "list", "trigger", "content"]
}), Pa = new eo("Tabs.Root");
class zu {
  static create(t) {
    return Pa.set(new zu(t));
  }
  opts;
  attachment;
  rovingFocusGroup;
  #e = /* @__PURE__ */ he(Gt([]));
  get triggerIds() {
    return a(this.#e);
  }
  set triggerIds(t) {
    Z(this.#e, t, !0);
  }
  valueToTriggerId = new $d();
  valueToContentId = new $d();
  constructor(t) {
    this.opts = t, this.attachment = pr(t.ref), this.rovingFocusGroup = new W5({
      candidateAttr: Is.trigger,
      rootNode: this.opts.ref,
      loop: this.opts.loop,
      orientation: this.opts.orientation
    });
  }
  registerTrigger(t, r) {
    return this.triggerIds.push(t), this.valueToTriggerId.set(r, t), () => {
      this.triggerIds = this.triggerIds.filter((n) => n !== t), this.valueToTriggerId.delete(r);
    };
  }
  registerContent(t, r) {
    return this.valueToContentId.set(r, t), () => {
      this.valueToContentId.delete(r);
    };
  }
  setValue(t) {
    this.opts.value.current = t;
  }
  #t = /* @__PURE__ */ T(() => ({
    id: this.opts.id.current,
    "data-orientation": this.opts.orientation.current,
    [Is.root]: "",
    ...this.attachment
  }));
  get props() {
    return a(this.#t);
  }
  set props(t) {
    Z(this.#t, t);
  }
}
class Au {
  static create(t) {
    return new Au(t, Pa.get());
  }
  opts;
  root;
  attachment;
  #e = /* @__PURE__ */ T(() => this.root.opts.disabled.current);
  constructor(t, r) {
    this.opts = t, this.root = r, this.attachment = pr(t.ref);
  }
  #t = /* @__PURE__ */ T(() => ({
    id: this.opts.id.current,
    role: "tablist",
    "aria-orientation": this.root.opts.orientation.current,
    "data-orientation": this.root.opts.orientation.current,
    [Is.list]: "",
    "data-disabled": la(a(this.#e)),
    ...this.attachment
  }));
  get props() {
    return a(this.#t);
  }
  set props(t) {
    Z(this.#t, t);
  }
}
class Eu {
  static create(t) {
    return new Eu(t, Pa.get());
  }
  opts;
  root;
  attachment;
  #e = /* @__PURE__ */ he(0);
  #t = /* @__PURE__ */ T(() => this.root.opts.value.current === this.opts.value.current);
  #r = /* @__PURE__ */ T(() => this.opts.disabled.current || this.root.opts.disabled.current);
  #o = /* @__PURE__ */ T(() => this.root.valueToContentId.get(this.opts.value.current));
  constructor(t, r) {
    this.opts = t, this.root = r, this.attachment = pr(t.ref), Kn([() => this.opts.id.current, () => this.opts.value.current], ([n, o]) => this.root.registerTrigger(n, o)), _t(() => {
      this.root.triggerIds.length, a(this.#t) || !this.root.opts.value.current ? Z(this.#e, 0) : Z(this.#e, -1);
    }), this.onfocus = this.onfocus.bind(this), this.onclick = this.onclick.bind(this), this.onkeydown = this.onkeydown.bind(this);
  }
  #n() {
    this.root.opts.value.current !== this.opts.value.current && this.root.setValue(this.opts.value.current);
  }
  onfocus(t) {
    this.root.opts.activationMode.current !== "automatic" || a(this.#r) || this.#n();
  }
  onclick(t) {
    a(this.#r) || this.#n();
  }
  onkeydown(t) {
    if (!a(this.#r)) {
      if (t.key === cg || t.key === lg) {
        t.preventDefault(), this.#n();
        return;
      }
      this.root.rovingFocusGroup.handleKeydown(this.opts.ref.current, t);
    }
  }
  #s = /* @__PURE__ */ T(() => ({
    id: this.opts.id.current,
    role: "tab",
    "data-state": mg(a(this.#t)),
    "data-value": this.opts.value.current,
    "data-orientation": this.root.opts.orientation.current,
    "data-disabled": la(a(this.#r)),
    "aria-selected": Xl(a(this.#t)),
    "aria-controls": a(this.#o),
    [Is.trigger]: "",
    disabled: ag(a(this.#r)),
    tabindex: a(this.#e),
    //
    onclick: this.onclick,
    onfocus: this.onfocus,
    onkeydown: this.onkeydown,
    ...this.attachment
  }));
  get props() {
    return a(this.#s);
  }
  set props(t) {
    Z(this.#s, t);
  }
}
class Mu {
  static create(t) {
    return new Mu(t, Pa.get());
  }
  opts;
  root;
  attachment;
  #e = /* @__PURE__ */ T(() => this.root.opts.value.current === this.opts.value.current);
  #t = /* @__PURE__ */ T(() => this.root.valueToTriggerId.get(this.opts.value.current));
  constructor(t, r) {
    this.opts = t, this.root = r, this.attachment = pr(t.ref), Kn([() => this.opts.id.current, () => this.opts.value.current], ([n, o]) => this.root.registerContent(n, o));
  }
  #r = /* @__PURE__ */ T(() => ({
    id: this.opts.id.current,
    role: "tabpanel",
    hidden: ag(!a(this.#e)),
    tabindex: this.opts.tabindex.current,
    "data-value": this.opts.value.current,
    "data-state": mg(a(this.#e)),
    "aria-labelledby": a(this.#t),
    "data-orientation": this.root.opts.orientation.current,
    [Is.content]: "",
    ...this.attachment
  }));
  get props() {
    return a(this.#r);
  }
  set props(t) {
    Z(this.#r, t);
  }
}
function mg(e) {
  return e ? "active" : "inactive";
}
var G$ = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "id",
  "ref",
  "value",
  "onValueChange",
  "orientation",
  "loop",
  "activationMode",
  "disabled",
  "children",
  "child"
]), K$ = /* @__PURE__ */ z("<div><!></div>");
function Y$(e, t) {
  const r = Zr();
  Ee(t, !0);
  let n = be(t, "id", 19, () => Ur(r)), o = be(t, "ref", 15, null), s = be(t, "value", 15, ""), i = be(t, "onValueChange", 3, q5), l = be(t, "orientation", 3, "horizontal"), c = be(t, "loop", 3, !0), u = be(t, "activationMode", 3, "automatic"), d = be(t, "disabled", 3, !1), f = /* @__PURE__ */ K(t, G$);
  const h = zu.create({
    id: Be(() => n()),
    value: Be(() => s(), (k) => {
      s(k), i()(k);
    }),
    orientation: Be(() => l()),
    loop: Be(() => c()),
    activationMode: Be(() => u()),
    disabled: Be(() => d()),
    ref: Be(() => o(), (k) => o(k))
  }), p = /* @__PURE__ */ T(() => Dt(f, h.props));
  var v = Ze(), g = re(v);
  {
    var y = (k) => {
      var S = Ze(), b = re(S);
      vt(b, () => t.child, () => ({ props: a(p) })), x(k, S);
    }, _ = (k) => {
      var S = K$();
      Et(S, () => ({ ...a(p) }));
      var b = M(S);
      vt(b, () => t.children ?? dt), x(k, S);
    };
    D(g, (k) => {
      t.child ? k(y) : k(_, -1);
    });
  }
  x(e, v), Me();
}
var X$ = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "children",
  "child",
  "id",
  "ref",
  "value",
  "tabindex"
]), J$ = /* @__PURE__ */ z("<div><!></div>");
function Q$(e, t) {
  const r = Zr();
  Ee(t, !0);
  let n = be(t, "id", 19, () => Ur(r)), o = be(t, "ref", 15, null), s = be(t, "tabindex", 3, 0), i = /* @__PURE__ */ K(t, X$);
  const l = Mu.create({
    value: Be(() => t.value),
    tabindex: Be(() => s() ?? 0),
    id: Be(() => n()),
    ref: Be(() => o(), (p) => o(p))
  }), c = /* @__PURE__ */ T(() => Dt(i, l.props));
  var u = Ze(), d = re(u);
  {
    var f = (p) => {
      var v = Ze(), g = re(v);
      vt(g, () => t.child, () => ({ props: a(c) })), x(p, v);
    }, h = (p) => {
      var v = J$();
      Et(v, () => ({ ...a(c) }));
      var g = M(v);
      vt(g, () => t.children ?? dt), x(p, v);
    };
    D(d, (p) => {
      t.child ? p(f) : p(h, -1);
    });
  }
  x(e, u), Me();
}
var e3 = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "child",
  "children",
  "id",
  "ref"
]), t3 = /* @__PURE__ */ z("<div><!></div>");
function r3(e, t) {
  const r = Zr();
  Ee(t, !0);
  let n = be(t, "id", 19, () => Ur(r)), o = be(t, "ref", 15, null), s = /* @__PURE__ */ K(t, e3);
  const i = Au.create({
    id: Be(() => n()),
    ref: Be(() => o(), (h) => o(h))
  }), l = /* @__PURE__ */ T(() => Dt(s, i.props));
  var c = Ze(), u = re(c);
  {
    var d = (h) => {
      var p = Ze(), v = re(p);
      vt(v, () => t.child, () => ({ props: a(l) })), x(h, p);
    }, f = (h) => {
      var p = t3();
      Et(p, () => ({ ...a(l) }));
      var v = M(p);
      vt(v, () => t.children ?? dt), x(h, p);
    };
    D(u, (h) => {
      t.child ? h(d) : h(f, -1);
    });
  }
  x(e, c), Me();
}
var n3 = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "child",
  "children",
  "disabled",
  "id",
  "type",
  "value",
  "ref"
]), o3 = /* @__PURE__ */ z("<button><!></button>");
function s3(e, t) {
  const r = Zr();
  Ee(t, !0);
  let n = be(t, "disabled", 3, !1), o = be(t, "id", 19, () => Ur(r)), s = be(t, "type", 3, "button"), i = be(t, "ref", 15, null), l = /* @__PURE__ */ K(t, n3);
  const c = Eu.create({
    id: Be(() => o()),
    disabled: Be(() => n() ?? !1),
    value: Be(() => t.value),
    ref: Be(() => i(), (v) => i(v))
  }), u = /* @__PURE__ */ T(() => Dt(l, c.props, { type: s() }));
  var d = Ze(), f = re(d);
  {
    var h = (v) => {
      var g = Ze(), y = re(g);
      vt(y, () => t.child, () => ({ props: a(u) })), x(v, g);
    }, p = (v) => {
      var g = o3();
      Et(g, () => ({ ...a(u) }));
      var y = M(g);
      vt(y, () => t.children ?? dt), x(v, g);
    };
    D(f, (v) => {
      t.child ? v(h) : v(p, -1);
    });
  }
  x(e, d), Me();
}
var i3 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function bg(e, t) {
  let r = /* @__PURE__ */ K(t, i3);
  const n = {
    name: "minus",
    size: 24,
    node: [["path", { d: "M5 12h14" }]]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var a3 = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "checked",
  "indeterminate",
  "class"
]), l3 = /* @__PURE__ */ z('<div data-slot="checkbox-indicator" class="[&amp;>svg]:size-3.5 grid place-content-center text-current transition-none"><!></div>');
function ua(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = be(t, "checked", 15, !1), o = be(t, "indeterminate", 15, !1), s = /* @__PURE__ */ K(t, a3);
  var i = Ze(), l = re(i);
  {
    const c = (d, f) => {
      let h = () => (f?.()).checked, p = () => (f?.()).indeterminate;
      var v = l3(), g = M(v);
      {
        var y = (k) => {
          iu(k, {});
        }, _ = (k) => {
          bg(k, {});
        };
        D(g, (k) => {
          h() ? k(y) : p() && k(_, 1);
        });
      }
      x(d, v);
    };
    let u = /* @__PURE__ */ T(() => sr("border-input dark:bg-input/30 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-checked:border-primary aria-invalid:aria-checked:border-primary aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 flex size-4 items-center justify-center rounded-[4px] border transition-colors group-has-disabled/field:opacity-50 focus-visible:ring-3 aria-invalid:ring-3 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input group-has-[:focus-visible]/field-label:data-checked:border-primary peer relative shrink-0 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50", t.class));
    It(l, () => o$, (d, f) => {
      f(d, J(
        {
          "data-slot": "checkbox",
          get class() {
            return a(u);
          }
        },
        () => s,
        {
          get ref() {
            return r();
          },
          set ref(h) {
            r(h);
          },
          get checked() {
            return n();
          },
          set checked(h) {
            n(h);
          },
          get indeterminate() {
            return o();
          },
          set indeterminate(h) {
            o(h);
          },
          children: c,
          $$slots: { default: !0 }
        }
      ));
    });
  }
  x(e, i), Me();
}
var c3 = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "value",
  "type",
  "files",
  "class",
  "data-slot"
]), bf = /* @__PURE__ */ z("<input/>");
function Tu(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = be(t, "value", 15), o = be(t, "files", 15), s = be(t, "data-slot", 3, "input"), i = /* @__PURE__ */ K(t, c3);
  var l = Ze(), c = re(l);
  {
    var u = (f) => {
      var h = bf();
      Et(
        h,
        (p) => ({
          "data-slot": s(),
          class: p,
          type: "file",
          ...i
        }),
        [
          () => sr("dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-8 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 md:text-sm w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50", t.class)
        ],
        void 0,
        void 0,
        void 0,
        !0
      ), _n(h, (p) => r(p), () => r()), Hb(h, o), Uo(h, n), x(f, h);
    }, d = (f) => {
      var h = bf();
      Et(
        h,
        (p) => ({
          "data-slot": s(),
          class: p,
          type: t.type,
          ...i
        }),
        [
          () => sr("dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-8 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 md:text-sm w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50", t.class)
        ],
        void 0,
        void 0,
        void 0,
        !0
      ), _n(h, (p) => r(p), () => r()), Uo(h, n), x(f, h);
    };
    D(c, (f) => {
      t.type === "file" ? f(u) : f(d, -1);
    });
  }
  x(e, l), Me();
}
const xg = (e) => ({
  entities: new Set(e?.entities.map((t) => t.id) ?? []),
  paths: new Set(e?.entities.flatMap((t) => t.paths) ?? [])
}), Cu = (e, t) => e.kind === "entity" && t.entities.has(e.id) || e.span !== void 0 && t.paths.has(e.span.path), yg = (e) => e.kind === "derived-fact" || e.derivation !== void 0, _g = (e, t, r, n) => {
  const o = n?.[t];
  if (o !== void 0) return o === "resolved";
  const s = e.canonicalRefs[t];
  return s !== void 0 && Cu(s, r);
}, Ou = (e, t, r) => {
  const n = e.canonicalRefs.some((o, s) => _g(e, s, t, r));
  return yg(e) ? n ? "derived" : "derived-unresolved" : n ? "canonical" : "unresolved";
}, u3 = {
  canonical: "Canonical source",
  derived: "Derived from a canonical source",
  "derived-unresolved": "Derived, unresolved",
  unresolved: "Source not resolved"
}, wg = {
  canonical: "Retrieved from a source that resolves to a file in the casebook.",
  derived: "An engine derived this; what it was derived from resolves to a file in the casebook. It is not itself on record.",
  "derived-unresolved": "An engine derived this and nothing ties it to a file in the casebook. It is not canonical verification.",
  unresolved: "Retrieved, but none of its references resolve to a file in the casebook."
}, tc = (e) => {
  const t = e.span, r = t?.startLine === void 0 ? "" : t.endLine === void 0 || t.endLine === t.startLine ? `:${t.startLine}` : `:${t.startLine}-${t.endLine}`, n = t ? `${t.path}${r}` : e.id;
  return e.revision ? `${n} @ ${e.revision}` : n;
}, d3 = [
  { id: "browse", label: "Browse" },
  { id: "ask", label: "Ask" },
  { id: "adapters", label: "Adapters" }
];
class f3 {
  #e = /* @__PURE__ */ he("browse");
  get route() {
    return a(this.#e);
  }
  set route(t) {
    Z(this.#e, t, !0);
  }
  constructor(t = "browse") {
    this.route = t;
  }
  href() {
    return null;
  }
  async go(t) {
    this.route = t;
  }
}
const kg = /* @__PURE__ */ Symbol("nav"), h3 = (e) => Ws(kg, e), p3 = () => go(kg);
var v3 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function g3(e, t) {
  let r = /* @__PURE__ */ K(t, v3);
  const n = {
    name: "info",
    size: 24,
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "M12 16v-4" }],
      ["path", { d: "M12 8h.01" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var m3 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Sg(e, t) {
  let r = /* @__PURE__ */ K(t, m3);
  const n = {
    name: "triangle-alert",
    size: 24,
    node: [
      [
        "path",
        {
          d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
        }
      ],
      ["path", { d: "M12 9v4" }],
      ["path", { d: "M12 17h.01" }]
    ],
    aliases: ["alert-triangle"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
const $g = /* @__PURE__ */ Symbol("type-style"), b3 = (e) => {
  Ws($g, e);
}, Nu = () => go($g);
var x3 = /* @__PURE__ */ z("<span><!></span>"), y3 = /* @__PURE__ */ z('<span style="border-color: var(--graph-other)" title="unresolved"></span>');
function vr(e, t) {
  Ee(t, !0);
  let r = be(t, "size", 3, "md"), n = be(t, "class", 3, "");
  const o = Nu(), s = /* @__PURE__ */ T(() => t.type === null ? null : o.icon(t.type)), i = { sm: "size-4", md: "size-5", lg: "size-7" }, l = { sm: "size-2.5", md: "size-3", lg: "size-4" };
  var c = Ze(), u = re(c);
  {
    var d = (h) => {
      var p = x3(), v = M(p);
      It(v, () => a(s), (g, y) => {
        y(g, {
          get class() {
            return l[r()];
          },
          strokeWidth: 2.25,
          "aria-hidden": "true"
        });
      }), L(
        (g) => {
          Ye(p, 1, `inline-grid shrink-0 place-items-center rounded-full text-white ${i[r()] ?? ""} ${n() ?? ""}`), Ln(p, `background: ${g ?? ""}`), $e(p, "title", t.type);
        },
        [() => o.colour(t.type)]
      ), x(h, p);
    }, f = (h) => {
      var p = y3();
      L(() => Ye(p, 1, `inline-block shrink-0 rounded-full border border-dashed ${i[r()] ?? ""} ${n() ?? ""}`)), x(h, p);
    };
    D(u, (h) => {
      a(s) && t.type !== null ? h(d) : h(f, -1);
    });
  }
  x(e, c), Me();
}
const zg = /* @__PURE__ */ Symbol("ask-view"), _3 = (e) => {
  Ws(zg, e);
}, Ia = () => go(zg), Pu = (e, t) => {
  const r = e.answer.evidence.findIndex((n) => n.id === t);
  return r < 0 ? t : `E${r + 1}`;
};
var w3 = /* @__PURE__ */ z('<button type="button"> </button>'), k3 = /* @__PURE__ */ z('<span class="inline-flex flex-wrap items-center gap-1"></span>');
function Sn(e, t) {
  Ee(t, !0);
  const r = zr(), n = Ia();
  var o = Ze(), s = re(o);
  {
    var i = (l) => {
      var c = k3();
      Ae(c, 20, () => [...new Set(t.ids)], (u) => u, (u, d) => {
        const f = /* @__PURE__ */ T(() => t.result.evidence.get(d));
        var h = Ze(), p = re(h);
        {
          var v = (g) => {
            const y = /* @__PURE__ */ T(() => Ou(a(f), n.casebook, t.result.references?.[a(f).id]));
            var _ = w3(), k = j(_, !0);
            L(
              (S, b) => {
                Ye(_, 1, `hover:bg-muted rounded border px-1 font-mono text-[10px] leading-4 ${a(y) === "canonical" ? "border-emerald-600/40" : a(y) === "derived" ? "border-sky-600/40" : "border-dashed border-amber-600/60"} ${r.inspector?.kind === "evidence" && r.inspector.evidenceId === d ? "bg-accent" : ""}`), $e(_, "title", `${a(f).kind}: ${a(f).text}`), $e(_, "aria-label", S), N(k, b);
              },
              [
                () => `Inspect evidence ${n.label(t.result, d)}: ${a(f).text}`,
                () => n.label(t.result, d)
              ]
            ), ht("click", _, () => r.inspectEvidence(d)), x(g, _);
          };
          D(p, (g) => {
            a(f) && g(v);
          });
        }
        x(u, h);
      }), x(l, c);
    };
    D(s, (l) => {
      t.ids.length > 0 && l(i);
    });
  }
  x(e, o), Me();
}
Lt(["click"]);
var S3 = /* @__PURE__ */ z('<span class="text-muted-foreground text-xs break-words"> </span>'), $3 = /* @__PURE__ */ z('<span class="text-muted-foreground shrink-0 text-xs tabular-nums"> </span>'), z3 = /* @__PURE__ */ z('<li><button type="button"><!> <span class="flex min-w-0 flex-1 flex-col"><span class="truncate font-medium"> </span> <span class="text-muted-foreground truncate font-mono text-xs"> </span> <!></span> <!> <!></button></li>'), A3 = /* @__PURE__ */ z("<!> Show on the board", 1), E3 = /* @__PURE__ */ z('<ol class="flex flex-col divide-y rounded-md border"></ol> <div class="flex flex-wrap items-center gap-2"><!> <!></div>', 1);
function M3(e, t) {
  Ee(t, !0);
  const r = zr(), n = /* @__PURE__ */ T(() => new Map(r.graph?.entities.map((f) => [f.id, f]) ?? [])), o = /* @__PURE__ */ T(() => t.block.entities.filter((f) => f.ref.kind === "entity").map((f) => f.ref.id));
  var s = E3(), i = re(s);
  Ae(i, 21, () => t.block.entities, xt, (f, h) => {
    const p = /* @__PURE__ */ T(() => a(h).ref.kind === "entity" ? a(n).get(a(h).ref.id) : void 0);
    var v = z3(), g = M(v), y = M(g);
    {
      let W = /* @__PURE__ */ T(() => a(p)?.type ?? null);
      vr(y, {
        get type() {
          return a(W);
        }
      });
    }
    var _ = m(y, 2), k = M(_), S = j(k, !0), b = m(k, 2), $ = j(b), E = m(b, 2);
    {
      var C = (W) => {
        var q = S3(), P = j(q, !0);
        L(() => N(P, a(h).detail)), x(W, q);
      };
      D(E, (W) => {
        a(h).detail && W(C);
      });
    }
    var w = m(_, 2);
    {
      var O = (W) => {
        Jt(W, {
          variant: "outline",
          class: "border-dashed text-[10px]",
          get title() {
            return `No file in the casebook defines this ${a(h).ref.kind ?? ""}`;
          },
          children: (q, P) => {
            var H = ct("unresolved");
            x(q, H);
          },
          $$slots: { default: !0 }
        });
      };
      D(w, (W) => {
        a(p) || W(O);
      });
    }
    var A = m(w, 2);
    {
      var R = (W) => {
        var q = $3(), P = j(q, !0);
        L(
          (H) => {
            $e(q, "title", `The adapter's own score: comparable only within ${t.result.adapter ?? ""}`), N(P, H);
          },
          [
            () => Number.isInteger(a(h).score) ? a(h).score : a(h).score.toFixed(2)
          ]
        ), x(W, q);
      };
      D(A, (W) => {
        a(h).score !== void 0 && W(R);
      });
    }
    L(() => {
      Ye(g, 1, `hover:bg-muted flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm disabled:cursor-default disabled:hover:bg-transparent ${r.selected === a(h).ref.id ? "bg-accent" : ""}`), g.disabled = !a(p), N(S, a(p)?.title ?? a(h).ref.id), N($, `${a(h).ref.id ?? ""}${a(h).ref.revision ? ` @ ${a(h).ref.revision}` : ""}`);
    }), ht("click", g, () => a(p) && r.select(a(p).id)), x(f, v);
  });
  var l = m(i, 2), c = M(l);
  Sn(c, {
    get ids() {
      return t.block.evidenceIds;
    },
    get result() {
      return t.result;
    }
  });
  var u = m(c, 2);
  {
    var d = (f) => {
      ft(f, {
        variant: "ghost",
        size: "xs",
        class: "ml-auto",
        onclick: () => t.onboard(a(o), `${t.result.adapter}'s ${t.block.title ?? "exhibits"}`),
        children: (h, p) => {
          var v = A3(), g = re(v);
          Ys(g, {}), x(h, v);
        },
        $$slots: { default: !0 }
      });
    };
    D(u, (f) => {
      a(o).length > 0 && f(d);
    });
  }
  x(e, s), Me();
}
Lt(["click"]);
var T3 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Ag(e, t) {
  let r = /* @__PURE__ */ K(t, T3);
  const n = {
    name: "badge-check",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
        }
      ],
      ["path", { d: "m16 9-5.5 5.5L8 12" }]
    ],
    aliases: ["verified"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var C3 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function O3(e, t) {
  let r = /* @__PURE__ */ K(t, C3);
  const n = {
    name: "circle-dashed",
    size: 24,
    node: [
      ["path", { d: "M10.1 2.182a10 10 0 0 1 3.8 0" }],
      ["path", { d: "M13.9 21.818a10 10 0 0 1-3.8 0" }],
      ["path", { d: "M17.609 3.721a10 10 0 0 1 2.69 2.7" }],
      ["path", { d: "M2.182 13.9a10 10 0 0 1 0-3.8" }],
      ["path", { d: "M20.279 17.609a10 10 0 0 1-2.7 2.69" }],
      ["path", { d: "M21.818 10.1a10 10 0 0 1 0 3.8" }],
      ["path", { d: "M3.721 6.391a10 10 0 0 1 2.7-2.69" }],
      ["path", { d: "M6.391 20.279a10 10 0 0 1-2.69-2.7" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var N3 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Eg(e, t) {
  let r = /* @__PURE__ */ K(t, N3);
  const n = {
    name: "sparkles",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"
        }
      ],
      ["path", { d: "M20 2v4" }],
      ["path", { d: "M22 4h-4" }],
      ["circle", { cx: "4", cy: "20", r: "2" }]
    ],
    aliases: ["stars"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var P3 = /* @__PURE__ */ z("<span><!> </span>");
function Mg(e, t) {
  Ee(t, !0);
  const r = {
    canonical: "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
    derived: "border-sky-600/40 bg-sky-600/10 text-sky-800 dark:text-sky-300",
    "derived-unresolved": "border-dashed border-amber-600/60 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    unresolved: "border-dashed border-muted-foreground/50 text-muted-foreground"
  };
  var n = P3(), o = M(n);
  {
    var s = (u) => {
      Ag(u, { class: "size-3", "aria-hidden": "true" });
    }, i = (u) => {
      O3(u, { class: "size-3", "aria-hidden": "true" });
    }, l = (u) => {
      Eg(u, { class: "size-3", "aria-hidden": "true" });
    };
    D(o, (u) => {
      t.standing === "canonical" ? u(s) : t.standing === "unresolved" ? u(i, 1) : u(l, -1);
    });
  }
  var c = m(o);
  L(() => {
    Ye(n, 1, `inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium whitespace-nowrap ${r[t.standing] ?? ""}`), $e(n, "title", wg[t.standing]), N(c, ` ${u3[t.standing] ?? ""}`);
  }), x(e, n), Me();
}
var I3 = /* @__PURE__ */ z('<span class="text-muted-foreground text-[10px]"> </span>'), R3 = /* @__PURE__ */ z('<span class="text-muted-foreground ml-auto text-[10px] tabular-nums"> </span>'), D3 = /* @__PURE__ */ z('<span class="break-words"> </span>'), L3 = /* @__PURE__ */ z('<blockquote class="border-gilt/60 border-l-2 pl-2.5 font-serif break-words"> </blockquote>'), j3 = /* @__PURE__ */ z('<span class="text-muted-foreground truncate font-mono text-[11px]"> </span>'), V3 = /* @__PURE__ */ z('<span class="text-muted-foreground text-[11px] italic">No canonical reference</span>'), F3 = /* @__PURE__ */ z('<button type="button"><span class="flex flex-wrap items-center gap-1.5"><span class="text-muted-foreground font-mono text-[10px]"> </span> <!> <!> <!></span> <!> <!></button>');
function Z3(e, t) {
  Ee(t, !0);
  const r = zr(), n = Ia(), o = /* @__PURE__ */ T(() => Ou(t.evidence, n.casebook, t.result.references?.[t.evidence.id])), s = /* @__PURE__ */ T(() => a(o) === "derived" || a(o) === "derived-unresolved"), i = /* @__PURE__ */ T(() => r.inspector?.kind === "evidence" && r.inspector.evidenceId === t.evidence.id), l = /* @__PURE__ */ T(() => t.evidence.canonicalRefs[0]);
  var c = F3(), u = M(c), d = M(u), f = j(d, !0), h = m(d, 2);
  Mg(h, {
    get standing() {
      return a(o);
    }
  });
  var p = m(h, 2);
  {
    var v = (C) => {
      var w = I3(), O = j(w);
      L(() => N(O, `by ${t.evidence.derivation.engine ?? ""}${t.evidence.derivation.model ? ` · ${t.evidence.derivation.model}` : ""}`)), x(C, w);
    };
    D(p, (C) => {
      t.evidence.derivation && C(v);
    });
  }
  var g = m(p, 2);
  {
    var y = (C) => {
      var w = R3(), O = j(w);
      L(() => {
        $e(w, "title", `The adapter's own score: comparable only within ${t.result.adapter ?? ""}`), N(O, `score ${t.evidence.score ?? ""}`);
      }), x(C, w);
    };
    D(g, (C) => {
      t.evidence.score !== void 0 && C(y);
    });
  }
  var _ = m(u, 2);
  {
    var k = (C) => {
      var w = D3(), O = j(w, !0);
      L(() => N(O, t.evidence.text)), x(C, w);
    }, S = (C) => {
      var w = L3(), O = j(w, !0);
      L(() => N(O, t.evidence.text)), x(C, w);
    };
    D(_, (C) => {
      a(s) ? C(k) : C(S, -1);
    });
  }
  var b = m(_, 2);
  {
    var $ = (C) => {
      var w = j3(), O = j(w);
      L(
        (A, R) => {
          $e(w, "title", A), N(O, `${R ?? ""}${t.evidence.canonicalRefs.length > 1 ? ` +${t.evidence.canonicalRefs.length - 1} more` : ""}`);
        },
        [
          () => tc(a(l)),
          () => tc(a(l))
        ]
      ), x(C, w);
    }, E = (C) => {
      var w = V3();
      x(C, w);
    };
    D(b, (C) => {
      a(l) ? C($) : C(E, -1);
    });
  }
  L(
    (C) => {
      Ye(c, 1, `bg-card hover:border-ring/60 flex w-full flex-col gap-1.5 rounded-md border p-3 text-left text-sm transition-colors ${a(o) === "derived-unresolved" ? "border-dashed border-amber-600/50" : ""} ${a(i) ? "ring-ring/50 ring-2" : ""}`), N(f, C);
    },
    [() => n.label(t.result, t.evidence.id)]
  ), ht("click", c, () => r.inspectEvidence(t.evidence.id)), x(e, c), Me();
}
Lt(["click"]);
var U3 = /* @__PURE__ */ z('<li class="min-w-0"><!></li>'), B3 = /* @__PURE__ */ z("<ul></ul>");
function W3(e, t) {
  Ee(t, !0);
  var r = B3();
  Ae(r, 20, () => [...new Set(t.block.evidenceIds)], (n) => n, (n, o) => {
    const s = /* @__PURE__ */ T(() => t.result.evidence.get(o));
    var i = Ze(), l = re(i);
    {
      var c = (u) => {
        var d = U3(), f = M(d);
        Z3(f, {
          get evidence() {
            return a(s);
          },
          get result() {
            return t.result;
          }
        }), x(u, d);
      };
      D(l, (u) => {
        a(s) && u(c);
      });
    }
    x(n, i);
  }), L(() => Ye(r, 1, `grid gap-2 ${t.block.kind === "facts" ? "sm:grid-cols-2" : ""}`)), x(e, r), Me();
}
const xf = 8, H3 = (e) => {
  const r = [...nc(e, (n) => n.type).entries()].sort(([n, o], [s, i]) => i - o || Cg(n, s));
  return new Map(r.map(([n], o) => [n, o + 1]));
}, rc = [
  [175, 240],
  [300, 340],
  [95, 130]
], q3 = rc.reduce((e, [t, r]) => e + r - t, 0), G3 = 0.618034, yf = [0, 0.1, -0.08], K3 = (e) => {
  let t = (e * G3 + 0.25) % 1 * q3;
  for (const [r, n] of rc) {
    if (t < n - r) return r + t;
    t -= n - r;
  }
  return rc[0]?.[0] ?? 0;
}, Y3 = (e) => {
  if (!e) return "var(--graph-other)";
  if (e <= xf) return `var(--series-${e})`;
  const t = e - xf - 1, r = yf[t % yf.length] ?? 0;
  return `oklch(${r === 0 ? "var(--series-generated-l)" : `calc(var(--series-generated-l) + ${r})`} var(--series-generated-c) ${K3(t).toFixed(1)})`;
}, nc = (e, t) => {
  const r = /* @__PURE__ */ new Map();
  for (const n of e) r.set(t(n), (r.get(t(n)) ?? 0) + 1);
  return r;
}, Po = (e) => `${e.source}\0${e.rel}\0${e.target}`, X3 = (e, t) => ({
  outgoing: e.edges.filter((r) => r.source === t),
  incoming: e.edges.filter((r) => r.target === t)
}), J3 = (e, t) => {
  const r = /* @__PURE__ */ new Set([t]);
  for (const n of e)
    n.source === t && r.add(n.target), n.target === t && r.add(n.source);
  return r;
}, Q3 = ["type", "rel", "tag"], ez = (e) => {
  const t = { type: [], rel: [], tag: [], words: [] };
  for (const r of e.toLowerCase().split(/\s+/).filter(Boolean)) {
    const [n, ...o] = r.split(":"), s = o.join(":"), i = Q3.find((l) => l === n);
    i && o.length > 0 ? s && t[i].push(s) : t.words.push(r);
  }
  return t;
}, Tg = (e, t) => {
  const r = e.toLowerCase();
  return r === t ? 4 : r.startsWith(t) ? 3 : new RegExp(`(^|[^a-z0-9])${tz(t)}`).test(r) ? 2 : r.includes(t) ? 1 : 0;
}, tz = (e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), rz = {
  id: 5,
  title: 5,
  type: 3,
  tag: 3,
  attribute: 2,
  body: 1
}, nz = (e) => [
  ["id", e.id],
  ["title", e.title],
  ["type", e.type],
  ...e.tags.map((t) => ["tag", t]),
  ...Object.values(e.attributes).filter((t) => typeof t == "string" || typeof t == "number").map((t) => ["attribute", String(t)]),
  ["body", e.content]
], oz = (e, t) => {
  const r = e.replace(/\s+/g, " ").trim(), n = r.toLowerCase().indexOf(t);
  if (n < 0) return "";
  const o = Math.max(0, n - 30);
  return `${o > 0 ? "…" : ""}${r.slice(o, n + t.length + 50)}${n + t.length + 50 < r.length ? "…" : ""}`;
}, sz = (e, t) => {
  let r = 0, n = { field: "body", value: 0, word: "" };
  for (const s of t) {
    let i = 0, l = "body";
    for (const [c, u] of nz(e)) {
      const d = Tg(u, s) * rz[c];
      d > i && (i = d, l = c);
    }
    if (i === 0) return null;
    r += i, i > n.value && (n = { field: l, value: i, word: s });
  }
  const o = { kind: "entity", entity: e, score: r, field: n.field };
  return n.field === "body" && (o.snippet = oz(e.content, n.word)), o;
}, iz = (e, t, r) => {
  const n = [e.rel, e.source, e.target, r.get(e.source) ?? "", r.get(e.target) ?? ""];
  let o = 0;
  for (const s of t) {
    const i = Math.max(...n.map((l, c) => Tg(l, s) * (c === 0 ? 3 : 1)));
    if (i === 0) return null;
    o += i;
  }
  return o;
}, az = (e, t, r = 20) => {
  const n = ez(t), o = n.type.length + n.rel.length + n.tag.length > 0;
  if (n.words.length === 0 && !o) return [];
  const s = [], i = (l) => n.type.every((c) => l.toLowerCase().startsWith(c));
  if (n.rel.length === 0)
    for (const l of e.entities) {
      if (!i(l.type) || !n.tag.every((u) => l.tags.some((d) => d.toLowerCase().startsWith(u)))) continue;
      if (n.words.length === 0) {
        s.push({ kind: "entity", entity: l, score: 1, field: n.type.length ? "type" : "tag" });
        continue;
      }
      const c = sz(l, n.words);
      c && s.push(c);
    }
  if (n.tag.length === 0 && (n.rel.length > 0 || n.words.length > 0)) {
    const l = new Map(e.entities.map((u) => [u.id, u.title])), c = new Map(e.entities.map((u) => [u.id, u.type]));
    for (const u of e.edges) {
      if (!n.rel.every((f) => u.rel.toLowerCase().startsWith(f)) || n.type.length > 0 && ![c.get(u.source), c.get(u.target)].some((h) => h !== void 0 && i(h)))
        continue;
      const d = n.words.length === 0 ? 1 : iz(u, n.words, l);
      d !== null && s.push({ kind: "relationship", edge: u, score: d - 0.5 });
    }
  }
  return s.sort((l, c) => c.score - l.score || Cg(_f(l), _f(c))).slice(0, r);
}, _f = (e) => e.kind === "entity" ? e.entity.id : Po(e.edge);
function Cg(e, t) {
  return e < t ? -1 : e > t ? 1 : 0;
}
const Og = (e) => {
  const t = (o) => typeof e[o] == "string" ? e[o] : "", r = t("path") ? `${t("path")}${t("lines") ? `:${t("lines")}` : ""}` : "", n = [t("method"), t("endpoint")].filter(Boolean).join(" ");
  return [t("repository"), r, t("symbol"), t("key"), n].filter(Boolean).join(" · ");
}, lz = /* @__PURE__ */ new Set([
  "source",
  "repository",
  "path",
  "lines",
  "symbol",
  "key",
  "method",
  "endpoint",
  "urls",
  "observedAt",
  "observedBy",
  "note"
]), cz = {
  evidence: "from evidence",
  stated: "stated in the file",
  unevidenced: "default - no evidence"
}, oc = (e) => cz[e] ?? e, Ng = (e) => typeof e == "string" && /^https?:\/\/\S+$/.test(e), uz = /`([^`\n]+)`|\[\[([^\]\n]+)\]\]|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)<>]+[^\s)<>.,;:!?'"])/g, cl = (e) => {
  const t = [];
  let r = 0;
  for (const n of e.matchAll(uz)) {
    const o = n.index ?? 0;
    o > r && t.push({ kind: "text", text: e.slice(r, o) }), n[1] !== void 0 ? t.push({ kind: "code", text: n[1] }) : n[2] !== void 0 ? t.push({ kind: "mention", id: n[2].trim() }) : n[3] !== void 0 && n[4] !== void 0 ? t.push({ kind: "link", text: n[3], href: n[4] }) : n[5] !== void 0 && t.push({ kind: "link", text: n[5], href: n[5] }), r = o + n[0].length;
  }
  return r < e.length && t.push({ kind: "text", text: e.slice(r) }), t;
}, dz = (e) => {
  const t = [], r = e.replace(/\r\n?/g, `
`).split(`
`);
  let n = [], o = null;
  const s = () => {
    n.length > 0 && t.push({ kind: "paragraph", text: cl(n.join(" ")) }), o && t.push({ kind: "list", items: o.map(cl) }), n = [], o = null;
  };
  for (let i = 0; i < r.length; i += 1) {
    const l = r[i] ?? "", c = /^\s*(```|~~~)/.exec(l);
    if (c) {
      s();
      const f = [];
      for (i += 1; i < r.length && !(r[i] ?? "").trim().startsWith(c[1] ?? "```"); i += 1)
        f.push(r[i] ?? "");
      t.push({ kind: "code", text: f.join(`
`) });
      continue;
    }
    const u = /^(#{1,6})\s+(.*)$/.exec(l), d = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l);
    u ? (s(), t.push({ kind: "heading", level: u[1]?.length ?? 1, text: cl(u[2] ?? "") })) : d ? (n.length > 0 && s(), o ??= [], o.push(d[1] ?? "")) : l.trim() === "" ? s() : o && /^\s+/.test(l) ? o[o.length - 1] += ` ${l.trim()}` : (o && s(), n.push(l.trim()));
  }
  return s(), t;
}, Pg = (e, t) => e.replace(/(?<!\[)\[([^[\]]+)\](?![\](])|`([^`\s]+)`/g, (r, n, o) => {
  if (o !== void 0) return t.has(o) ? `[[${o}]]` : r;
  const s = (n ?? "").split(/([,;])/);
  return s.some((i) => t.has(i.trim())) ? s.map((i) => t.has(i.trim()) ? i.replace(i.trim(), `[[${i.trim()}]]`) : i).join("") : r;
}), wf = (e) => {
  const t = new Set(e.summary?.cited ?? []);
  return t.size === 0 ? e.answer : {
    ...e.answer,
    documents: e.answer.documents.filter((r) => t.has(r.id)),
    paths: e.answer.paths.filter((r) => t.has(r.nodes[0] ?? "") && t.has(r.nodes.at(-1) ?? ""))
  };
};
function fz(e) {
  const t = +this._x.call(null, e), r = +this._y.call(null, e);
  return Ig(this.cover(t, r), t, r, e);
}
function Ig(e, t, r, n) {
  if (isNaN(t) || isNaN(r)) return e;
  var o, s = e._root, i = { data: n }, l = e._x0, c = e._y0, u = e._x1, d = e._y1, f, h, p, v, g, y, _, k;
  if (!s) return e._root = i, e;
  for (; s.length; )
    if ((g = t >= (f = (l + u) / 2)) ? l = f : u = f, (y = r >= (h = (c + d) / 2)) ? c = h : d = h, o = s, !(s = s[_ = y << 1 | g])) return o[_] = i, e;
  if (p = +e._x.call(null, s.data), v = +e._y.call(null, s.data), t === p && r === v) return i.next = s, o ? o[_] = i : e._root = i, e;
  do
    o = o ? o[_] = new Array(4) : e._root = new Array(4), (g = t >= (f = (l + u) / 2)) ? l = f : u = f, (y = r >= (h = (c + d) / 2)) ? c = h : d = h;
  while ((_ = y << 1 | g) === (k = (v >= h) << 1 | p >= f));
  return o[k] = s, o[_] = i, e;
}
function hz(e) {
  var t, r, n = e.length, o, s, i = new Array(n), l = new Array(n), c = 1 / 0, u = 1 / 0, d = -1 / 0, f = -1 / 0;
  for (r = 0; r < n; ++r)
    isNaN(o = +this._x.call(null, t = e[r])) || isNaN(s = +this._y.call(null, t)) || (i[r] = o, l[r] = s, o < c && (c = o), o > d && (d = o), s < u && (u = s), s > f && (f = s));
  if (c > d || u > f) return this;
  for (this.cover(c, u).cover(d, f), r = 0; r < n; ++r)
    Ig(this, i[r], l[r], e[r]);
  return this;
}
function pz(e, t) {
  if (isNaN(e = +e) || isNaN(t = +t)) return this;
  var r = this._x0, n = this._y0, o = this._x1, s = this._y1;
  if (isNaN(r))
    o = (r = Math.floor(e)) + 1, s = (n = Math.floor(t)) + 1;
  else {
    for (var i = o - r || 1, l = this._root, c, u; r > e || e >= o || n > t || t >= s; )
      switch (u = (t < n) << 1 | e < r, c = new Array(4), c[u] = l, l = c, i *= 2, u) {
        case 0:
          o = r + i, s = n + i;
          break;
        case 1:
          r = o - i, s = n + i;
          break;
        case 2:
          o = r + i, n = s - i;
          break;
        case 3:
          r = o - i, n = s - i;
          break;
      }
    this._root && this._root.length && (this._root = l);
  }
  return this._x0 = r, this._y0 = n, this._x1 = o, this._y1 = s, this;
}
function vz() {
  var e = [];
  return this.visit(function(t) {
    if (!t.length) do
      e.push(t.data);
    while (t = t.next);
  }), e;
}
function gz(e) {
  return arguments.length ? this.cover(+e[0][0], +e[0][1]).cover(+e[1][0], +e[1][1]) : isNaN(this._x0) ? void 0 : [[this._x0, this._y0], [this._x1, this._y1]];
}
function qt(e, t, r, n, o) {
  this.node = e, this.x0 = t, this.y0 = r, this.x1 = n, this.y1 = o;
}
function mz(e, t, r) {
  var n, o = this._x0, s = this._y0, i, l, c, u, d = this._x1, f = this._y1, h = [], p = this._root, v, g;
  for (p && h.push(new qt(p, o, s, d, f)), r == null ? r = 1 / 0 : (o = e - r, s = t - r, d = e + r, f = t + r, r *= r); v = h.pop(); )
    if (!(!(p = v.node) || (i = v.x0) > d || (l = v.y0) > f || (c = v.x1) < o || (u = v.y1) < s))
      if (p.length) {
        var y = (i + c) / 2, _ = (l + u) / 2;
        h.push(
          new qt(p[3], y, _, c, u),
          new qt(p[2], i, _, y, u),
          new qt(p[1], y, l, c, _),
          new qt(p[0], i, l, y, _)
        ), (g = (t >= _) << 1 | e >= y) && (v = h[h.length - 1], h[h.length - 1] = h[h.length - 1 - g], h[h.length - 1 - g] = v);
      } else {
        var k = e - +this._x.call(null, p.data), S = t - +this._y.call(null, p.data), b = k * k + S * S;
        if (b < r) {
          var $ = Math.sqrt(r = b);
          o = e - $, s = t - $, d = e + $, f = t + $, n = p.data;
        }
      }
  return n;
}
function bz(e) {
  if (isNaN(d = +this._x.call(null, e)) || isNaN(f = +this._y.call(null, e))) return this;
  var t, r = this._root, n, o, s, i = this._x0, l = this._y0, c = this._x1, u = this._y1, d, f, h, p, v, g, y, _;
  if (!r) return this;
  if (r.length) for (; ; ) {
    if ((v = d >= (h = (i + c) / 2)) ? i = h : c = h, (g = f >= (p = (l + u) / 2)) ? l = p : u = p, t = r, !(r = r[y = g << 1 | v])) return this;
    if (!r.length) break;
    (t[y + 1 & 3] || t[y + 2 & 3] || t[y + 3 & 3]) && (n = t, _ = y);
  }
  for (; r.data !== e; ) if (o = r, !(r = r.next)) return this;
  return (s = r.next) && delete r.next, o ? (s ? o.next = s : delete o.next, this) : t ? (s ? t[y] = s : delete t[y], (r = t[0] || t[1] || t[2] || t[3]) && r === (t[3] || t[2] || t[1] || t[0]) && !r.length && (n ? n[_] = r : this._root = r), this) : (this._root = s, this);
}
function xz(e) {
  for (var t = 0, r = e.length; t < r; ++t) this.remove(e[t]);
  return this;
}
function yz() {
  return this._root;
}
function _z() {
  var e = 0;
  return this.visit(function(t) {
    if (!t.length) do
      ++e;
    while (t = t.next);
  }), e;
}
function wz(e) {
  var t = [], r, n = this._root, o, s, i, l, c;
  for (n && t.push(new qt(n, this._x0, this._y0, this._x1, this._y1)); r = t.pop(); )
    if (!e(n = r.node, s = r.x0, i = r.y0, l = r.x1, c = r.y1) && n.length) {
      var u = (s + l) / 2, d = (i + c) / 2;
      (o = n[3]) && t.push(new qt(o, u, d, l, c)), (o = n[2]) && t.push(new qt(o, s, d, u, c)), (o = n[1]) && t.push(new qt(o, u, i, l, d)), (o = n[0]) && t.push(new qt(o, s, i, u, d));
    }
  return this;
}
function kz(e) {
  var t = [], r = [], n;
  for (this._root && t.push(new qt(this._root, this._x0, this._y0, this._x1, this._y1)); n = t.pop(); ) {
    var o = n.node;
    if (o.length) {
      var s, i = n.x0, l = n.y0, c = n.x1, u = n.y1, d = (i + c) / 2, f = (l + u) / 2;
      (s = o[0]) && t.push(new qt(s, i, l, d, f)), (s = o[1]) && t.push(new qt(s, d, l, c, f)), (s = o[2]) && t.push(new qt(s, i, f, d, u)), (s = o[3]) && t.push(new qt(s, d, f, c, u));
    }
    r.push(n);
  }
  for (; n = r.pop(); )
    e(n.node, n.x0, n.y0, n.x1, n.y1);
  return this;
}
function Sz(e) {
  return e[0];
}
function $z(e) {
  return arguments.length ? (this._x = e, this) : this._x;
}
function zz(e) {
  return e[1];
}
function Az(e) {
  return arguments.length ? (this._y = e, this) : this._y;
}
function Iu(e, t, r) {
  var n = new Ru(t ?? Sz, r ?? zz, NaN, NaN, NaN, NaN);
  return e == null ? n : n.addAll(e);
}
function Ru(e, t, r, n, o, s) {
  this._x = e, this._y = t, this._x0 = r, this._y0 = n, this._x1 = o, this._y1 = s, this._root = void 0;
}
function kf(e) {
  for (var t = { data: e.data }, r = t; e = e.next; ) r = r.next = { data: e.data };
  return t;
}
var Qt = Iu.prototype = Ru.prototype;
Qt.copy = function() {
  var e = new Ru(this._x, this._y, this._x0, this._y0, this._x1, this._y1), t = this._root, r, n;
  if (!t) return e;
  if (!t.length) return e._root = kf(t), e;
  for (r = [{ source: t, target: e._root = new Array(4) }]; t = r.pop(); )
    for (var o = 0; o < 4; ++o)
      (n = t.source[o]) && (n.length ? r.push({ source: n, target: t.target[o] = new Array(4) }) : t.target[o] = kf(n));
  return e;
};
Qt.add = fz;
Qt.addAll = hz;
Qt.cover = pz;
Qt.data = vz;
Qt.extent = gz;
Qt.find = mz;
Qt.remove = bz;
Qt.removeAll = xz;
Qt.root = yz;
Qt.size = _z;
Qt.visit = wz;
Qt.visitAfter = kz;
Qt.x = $z;
Qt.y = Az;
function Kt(e) {
  return function() {
    return e;
  };
}
function Vn(e) {
  return (e() - 0.5) * 1e-6;
}
function Ez(e) {
  return e.x + e.vx;
}
function Mz(e) {
  return e.y + e.vy;
}
function Tz(e) {
  var t, r, n, o = 1, s = 1;
  typeof e != "function" && (e = Kt(e == null ? 1 : +e));
  function i() {
    for (var u, d = t.length, f, h, p, v, g, y, _ = 0; _ < s; ++_)
      for (f = Iu(t, Ez, Mz).visitAfter(l), u = 0; u < d; ++u)
        h = t[u], g = r[h.index], y = g * g, p = h.x + h.vx, v = h.y + h.vy, f.visit(k);
    function k(S, b, $, E, C) {
      var w = S.data, O = S.r, A = g + O;
      if (w) {
        if (w.index > h.index) {
          var R = p - w.x - w.vx, W = v - w.y - w.vy, q = R * R + W * W;
          q < A * A && (R === 0 && (R = Vn(n), q += R * R), W === 0 && (W = Vn(n), q += W * W), q = (A - (q = Math.sqrt(q))) / q * o, h.vx += (R *= q) * (A = (O *= O) / (y + O)), h.vy += (W *= q) * A, w.vx -= R * (A = 1 - A), w.vy -= W * A);
        }
        return;
      }
      return b > p + A || E < p - A || $ > v + A || C < v - A;
    }
  }
  function l(u) {
    if (u.data) return u.r = r[u.data.index];
    for (var d = u.r = 0; d < 4; ++d)
      u[d] && u[d].r > u.r && (u.r = u[d].r);
  }
  function c() {
    if (t) {
      var u, d = t.length, f;
      for (r = new Array(d), u = 0; u < d; ++u) f = t[u], r[f.index] = +e(f, u, t);
    }
  }
  return i.initialize = function(u, d) {
    t = u, n = d, c();
  }, i.iterations = function(u) {
    return arguments.length ? (s = +u, i) : s;
  }, i.strength = function(u) {
    return arguments.length ? (o = +u, i) : o;
  }, i.radius = function(u) {
    return arguments.length ? (e = typeof u == "function" ? u : Kt(+u), c(), i) : e;
  }, i;
}
function Cz(e) {
  return e.index;
}
function Sf(e, t) {
  var r = e.get(t);
  if (!r) throw new Error("node not found: " + t);
  return r;
}
function Oz(e) {
  var t = Cz, r = f, n, o = Kt(30), s, i, l, c, u, d = 1;
  e == null && (e = []);
  function f(y) {
    return 1 / Math.min(l[y.source.index], l[y.target.index]);
  }
  function h(y) {
    for (var _ = 0, k = e.length; _ < d; ++_)
      for (var S = 0, b, $, E, C, w, O, A; S < k; ++S)
        b = e[S], $ = b.source, E = b.target, C = E.x + E.vx - $.x - $.vx || Vn(u), w = E.y + E.vy - $.y - $.vy || Vn(u), O = Math.sqrt(C * C + w * w), O = (O - s[S]) / O * y * n[S], C *= O, w *= O, E.vx -= C * (A = c[S]), E.vy -= w * A, $.vx += C * (A = 1 - A), $.vy += w * A;
  }
  function p() {
    if (i) {
      var y, _ = i.length, k = e.length, S = new Map(i.map(($, E) => [t($, E, i), $])), b;
      for (y = 0, l = new Array(_); y < k; ++y)
        b = e[y], b.index = y, typeof b.source != "object" && (b.source = Sf(S, b.source)), typeof b.target != "object" && (b.target = Sf(S, b.target)), l[b.source.index] = (l[b.source.index] || 0) + 1, l[b.target.index] = (l[b.target.index] || 0) + 1;
      for (y = 0, c = new Array(k); y < k; ++y)
        b = e[y], c[y] = l[b.source.index] / (l[b.source.index] + l[b.target.index]);
      n = new Array(k), v(), s = new Array(k), g();
    }
  }
  function v() {
    if (i)
      for (var y = 0, _ = e.length; y < _; ++y)
        n[y] = +r(e[y], y, e);
  }
  function g() {
    if (i)
      for (var y = 0, _ = e.length; y < _; ++y)
        s[y] = +o(e[y], y, e);
  }
  return h.initialize = function(y, _) {
    i = y, u = _, p();
  }, h.links = function(y) {
    return arguments.length ? (e = y, p(), h) : e;
  }, h.id = function(y) {
    return arguments.length ? (t = y, h) : t;
  }, h.iterations = function(y) {
    return arguments.length ? (d = +y, h) : d;
  }, h.strength = function(y) {
    return arguments.length ? (r = typeof y == "function" ? y : Kt(+y), v(), h) : r;
  }, h.distance = function(y) {
    return arguments.length ? (o = typeof y == "function" ? y : Kt(+y), g(), h) : o;
  }, h;
}
var Nz = { value: () => {
} };
function ni() {
  for (var e = 0, t = arguments.length, r = {}, n; e < t; ++e) {
    if (!(n = arguments[e] + "") || n in r || /[\s.]/.test(n)) throw new Error("illegal type: " + n);
    r[n] = [];
  }
  return new ji(r);
}
function ji(e) {
  this._ = e;
}
function Pz(e, t) {
  return e.trim().split(/^|\s+/).map(function(r) {
    var n = "", o = r.indexOf(".");
    if (o >= 0 && (n = r.slice(o + 1), r = r.slice(0, o)), r && !t.hasOwnProperty(r)) throw new Error("unknown type: " + r);
    return { type: r, name: n };
  });
}
ji.prototype = ni.prototype = {
  constructor: ji,
  on: function(e, t) {
    var r = this._, n = Pz(e + "", r), o, s = -1, i = n.length;
    if (arguments.length < 2) {
      for (; ++s < i; ) if ((o = (e = n[s]).type) && (o = Iz(r[o], e.name))) return o;
      return;
    }
    if (t != null && typeof t != "function") throw new Error("invalid callback: " + t);
    for (; ++s < i; )
      if (o = (e = n[s]).type) r[o] = $f(r[o], e.name, t);
      else if (t == null) for (o in r) r[o] = $f(r[o], e.name, null);
    return this;
  },
  copy: function() {
    var e = {}, t = this._;
    for (var r in t) e[r] = t[r].slice();
    return new ji(e);
  },
  call: function(e, t) {
    if ((o = arguments.length - 2) > 0) for (var r = new Array(o), n = 0, o, s; n < o; ++n) r[n] = arguments[n + 2];
    if (!this._.hasOwnProperty(e)) throw new Error("unknown type: " + e);
    for (s = this._[e], n = 0, o = s.length; n < o; ++n) s[n].value.apply(t, r);
  },
  apply: function(e, t, r) {
    if (!this._.hasOwnProperty(e)) throw new Error("unknown type: " + e);
    for (var n = this._[e], o = 0, s = n.length; o < s; ++o) n[o].value.apply(t, r);
  }
};
function Iz(e, t) {
  for (var r = 0, n = e.length, o; r < n; ++r)
    if ((o = e[r]).name === t)
      return o.value;
}
function $f(e, t, r) {
  for (var n = 0, o = e.length; n < o; ++n)
    if (e[n].name === t) {
      e[n] = Nz, e = e.slice(0, n).concat(e.slice(n + 1));
      break;
    }
  return r != null && e.push({ name: t, value: r }), e;
}
var Xo = 0, _s = 0, hs = 0, Rg = 1e3, da, ws, fa = 0, _o = 0, Ra = 0, Rs = typeof performance == "object" && performance.now ? performance : Date, Dg = typeof window == "object" && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(e) {
  setTimeout(e, 17);
};
function Du() {
  return _o || (Dg(Rz), _o = Rs.now() + Ra);
}
function Rz() {
  _o = 0;
}
function ha() {
  this._call = this._time = this._next = null;
}
ha.prototype = Lu.prototype = {
  constructor: ha,
  restart: function(e, t, r) {
    if (typeof e != "function") throw new TypeError("callback is not a function");
    r = (r == null ? Du() : +r) + (t == null ? 0 : +t), !this._next && ws !== this && (ws ? ws._next = this : da = this, ws = this), this._call = e, this._time = r, sc();
  },
  stop: function() {
    this._call && (this._call = null, this._time = 1 / 0, sc());
  }
};
function Lu(e, t, r) {
  var n = new ha();
  return n.restart(e, t, r), n;
}
function Dz() {
  Du(), ++Xo;
  for (var e = da, t; e; )
    (t = _o - e._time) >= 0 && e._call.call(void 0, t), e = e._next;
  --Xo;
}
function zf() {
  _o = (fa = Rs.now()) + Ra, Xo = _s = 0;
  try {
    Dz();
  } finally {
    Xo = 0, jz(), _o = 0;
  }
}
function Lz() {
  var e = Rs.now(), t = e - fa;
  t > Rg && (Ra -= t, fa = e);
}
function jz() {
  for (var e, t = da, r, n = 1 / 0; t; )
    t._call ? (n > t._time && (n = t._time), e = t, t = t._next) : (r = t._next, t._next = null, t = e ? e._next = r : da = r);
  ws = e, sc(n);
}
function sc(e) {
  if (!Xo) {
    _s && (_s = clearTimeout(_s));
    var t = e - _o;
    t > 24 ? (e < 1 / 0 && (_s = setTimeout(zf, e - Rs.now() - Ra)), hs && (hs = clearInterval(hs))) : (hs || (fa = Rs.now(), hs = setInterval(Lz, Rg)), Xo = 1, Dg(zf));
  }
}
function Af(e, t, r) {
  var n = new ha();
  return t = t == null ? 0 : +t, n.restart((o) => {
    n.stop(), e(o + t);
  }, t, r), n;
}
const Vz = 1664525, Fz = 1013904223, Ef = 4294967296;
function Zz() {
  let e = 1;
  return () => (e = (Vz * e + Fz) % Ef) / Ef;
}
function Uz(e) {
  return e.x;
}
function Bz(e) {
  return e.y;
}
var Wz = 10, Hz = Math.PI * (3 - Math.sqrt(5));
function qz(e) {
  var t, r = 1, n = 1e-3, o = 1 - Math.pow(n, 1 / 300), s = 0, i = 0.6, l = /* @__PURE__ */ new Map(), c = Lu(f), u = ni("tick", "end"), d = Zz();
  e == null && (e = []);
  function f() {
    h(), u.call("tick", t), r < n && (c.stop(), u.call("end", t));
  }
  function h(g) {
    var y, _ = e.length, k;
    g === void 0 && (g = 1);
    for (var S = 0; S < g; ++S)
      for (r += (s - r) * o, l.forEach(function(b) {
        b(r);
      }), y = 0; y < _; ++y)
        k = e[y], k.fx == null ? k.x += k.vx *= i : (k.x = k.fx, k.vx = 0), k.fy == null ? k.y += k.vy *= i : (k.y = k.fy, k.vy = 0);
    return t;
  }
  function p() {
    for (var g = 0, y = e.length, _; g < y; ++g) {
      if (_ = e[g], _.index = g, _.fx != null && (_.x = _.fx), _.fy != null && (_.y = _.fy), isNaN(_.x) || isNaN(_.y)) {
        var k = Wz * Math.sqrt(0.5 + g), S = g * Hz;
        _.x = k * Math.cos(S), _.y = k * Math.sin(S);
      }
      (isNaN(_.vx) || isNaN(_.vy)) && (_.vx = _.vy = 0);
    }
  }
  function v(g) {
    return g.initialize && g.initialize(e, d), g;
  }
  return p(), t = {
    tick: h,
    restart: function() {
      return c.restart(f), t;
    },
    stop: function() {
      return c.stop(), t;
    },
    nodes: function(g) {
      return arguments.length ? (e = g, p(), l.forEach(v), t) : e;
    },
    alpha: function(g) {
      return arguments.length ? (r = +g, t) : r;
    },
    alphaMin: function(g) {
      return arguments.length ? (n = +g, t) : n;
    },
    alphaDecay: function(g) {
      return arguments.length ? (o = +g, t) : +o;
    },
    alphaTarget: function(g) {
      return arguments.length ? (s = +g, t) : s;
    },
    velocityDecay: function(g) {
      return arguments.length ? (i = 1 - g, t) : 1 - i;
    },
    randomSource: function(g) {
      return arguments.length ? (d = g, l.forEach(v), t) : d;
    },
    force: function(g, y) {
      return arguments.length > 1 ? (y == null ? l.delete(g) : l.set(g, v(y)), t) : l.get(g);
    },
    find: function(g, y, _) {
      var k = 0, S = e.length, b, $, E, C, w;
      for (_ == null ? _ = 1 / 0 : _ *= _, k = 0; k < S; ++k)
        C = e[k], b = g - C.x, $ = y - C.y, E = b * b + $ * $, E < _ && (w = C, _ = E);
      return w;
    },
    on: function(g, y) {
      return arguments.length > 1 ? (u.on(g, y), t) : u.on(g);
    }
  };
}
function Gz() {
  var e, t, r, n, o = Kt(-30), s, i = 1, l = 1 / 0, c = 0.81;
  function u(p) {
    var v, g = e.length, y = Iu(e, Uz, Bz).visitAfter(f);
    for (n = p, v = 0; v < g; ++v) t = e[v], y.visit(h);
  }
  function d() {
    if (e) {
      var p, v = e.length, g;
      for (s = new Array(v), p = 0; p < v; ++p) g = e[p], s[g.index] = +o(g, p, e);
    }
  }
  function f(p) {
    var v = 0, g, y, _ = 0, k, S, b;
    if (p.length) {
      for (k = S = b = 0; b < 4; ++b)
        (g = p[b]) && (y = Math.abs(g.value)) && (v += g.value, _ += y, k += y * g.x, S += y * g.y);
      p.x = k / _, p.y = S / _;
    } else {
      g = p, g.x = g.data.x, g.y = g.data.y;
      do
        v += s[g.data.index];
      while (g = g.next);
    }
    p.value = v;
  }
  function h(p, v, g, y) {
    if (!p.value) return !0;
    var _ = p.x - t.x, k = p.y - t.y, S = y - v, b = _ * _ + k * k;
    if (S * S / c < b)
      return b < l && (_ === 0 && (_ = Vn(r), b += _ * _), k === 0 && (k = Vn(r), b += k * k), b < i && (b = Math.sqrt(i * b)), t.vx += _ * p.value * n / b, t.vy += k * p.value * n / b), !0;
    if (p.length || b >= l) return;
    (p.data !== t || p.next) && (_ === 0 && (_ = Vn(r), b += _ * _), k === 0 && (k = Vn(r), b += k * k), b < i && (b = Math.sqrt(i * b)));
    do
      p.data !== t && (S = s[p.data.index] * n / b, t.vx += _ * S, t.vy += k * S);
    while (p = p.next);
  }
  return u.initialize = function(p, v) {
    e = p, r = v, d();
  }, u.strength = function(p) {
    return arguments.length ? (o = typeof p == "function" ? p : Kt(+p), d(), u) : o;
  }, u.distanceMin = function(p) {
    return arguments.length ? (i = p * p, u) : Math.sqrt(i);
  }, u.distanceMax = function(p) {
    return arguments.length ? (l = p * p, u) : Math.sqrt(l);
  }, u.theta = function(p) {
    return arguments.length ? (c = p * p, u) : Math.sqrt(c);
  }, u;
}
function Kz(e) {
  var t = Kt(0.1), r, n, o;
  typeof e != "function" && (e = Kt(e == null ? 0 : +e));
  function s(l) {
    for (var c = 0, u = r.length, d; c < u; ++c)
      d = r[c], d.vx += (o[c] - d.x) * n[c] * l;
  }
  function i() {
    if (r) {
      var l, c = r.length;
      for (n = new Array(c), o = new Array(c), l = 0; l < c; ++l)
        n[l] = isNaN(o[l] = +e(r[l], l, r)) ? 0 : +t(r[l], l, r);
    }
  }
  return s.initialize = function(l) {
    r = l, i();
  }, s.strength = function(l) {
    return arguments.length ? (t = typeof l == "function" ? l : Kt(+l), i(), s) : t;
  }, s.x = function(l) {
    return arguments.length ? (e = typeof l == "function" ? l : Kt(+l), i(), s) : e;
  }, s;
}
function Yz(e) {
  var t = Kt(0.1), r, n, o;
  typeof e != "function" && (e = Kt(e == null ? 0 : +e));
  function s(l) {
    for (var c = 0, u = r.length, d; c < u; ++c)
      d = r[c], d.vy += (o[c] - d.y) * n[c] * l;
  }
  function i() {
    if (r) {
      var l, c = r.length;
      for (n = new Array(c), o = new Array(c), l = 0; l < c; ++l)
        n[l] = isNaN(o[l] = +e(r[l], l, r)) ? 0 : +t(r[l], l, r);
    }
  }
  return s.initialize = function(l) {
    r = l, i();
  }, s.strength = function(l) {
    return arguments.length ? (t = typeof l == "function" ? l : Kt(+l), i(), s) : t;
  }, s.y = function(l) {
    return arguments.length ? (e = typeof l == "function" ? l : Kt(+l), i(), s) : e;
  }, s;
}
var ic = "http://www.w3.org/1999/xhtml";
const Mf = {
  svg: "http://www.w3.org/2000/svg",
  xhtml: ic,
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace",
  xmlns: "http://www.w3.org/2000/xmlns/"
};
function Da(e) {
  var t = e += "", r = t.indexOf(":");
  return r >= 0 && (t = e.slice(0, r)) !== "xmlns" && (e = e.slice(r + 1)), Mf.hasOwnProperty(t) ? { space: Mf[t], local: e } : e;
}
function Xz(e) {
  return function() {
    var t = this.ownerDocument, r = this.namespaceURI;
    return r === ic && t.documentElement.namespaceURI === ic ? t.createElement(e) : t.createElementNS(r, e);
  };
}
function Jz(e) {
  return function() {
    return this.ownerDocument.createElementNS(e.space, e.local);
  };
}
function Lg(e) {
  var t = Da(e);
  return (t.local ? Jz : Xz)(t);
}
function Qz() {
}
function ju(e) {
  return e == null ? Qz : function() {
    return this.querySelector(e);
  };
}
function e6(e) {
  typeof e != "function" && (e = ju(e));
  for (var t = this._groups, r = t.length, n = new Array(r), o = 0; o < r; ++o)
    for (var s = t[o], i = s.length, l = n[o] = new Array(i), c, u, d = 0; d < i; ++d)
      (c = s[d]) && (u = e.call(c, c.__data__, d, s)) && ("__data__" in c && (u.__data__ = c.__data__), l[d] = u);
  return new gr(n, this._parents);
}
function t6(e) {
  return e == null ? [] : Array.isArray(e) ? e : Array.from(e);
}
function r6() {
  return [];
}
function jg(e) {
  return e == null ? r6 : function() {
    return this.querySelectorAll(e);
  };
}
function n6(e) {
  return function() {
    return t6(e.apply(this, arguments));
  };
}
function o6(e) {
  typeof e == "function" ? e = n6(e) : e = jg(e);
  for (var t = this._groups, r = t.length, n = [], o = [], s = 0; s < r; ++s)
    for (var i = t[s], l = i.length, c, u = 0; u < l; ++u)
      (c = i[u]) && (n.push(e.call(c, c.__data__, u, i)), o.push(c));
  return new gr(n, o);
}
function Vg(e) {
  return function() {
    return this.matches(e);
  };
}
function Fg(e) {
  return function(t) {
    return t.matches(e);
  };
}
var s6 = Array.prototype.find;
function i6(e) {
  return function() {
    return s6.call(this.children, e);
  };
}
function a6() {
  return this.firstElementChild;
}
function l6(e) {
  return this.select(e == null ? a6 : i6(typeof e == "function" ? e : Fg(e)));
}
var c6 = Array.prototype.filter;
function u6() {
  return Array.from(this.children);
}
function d6(e) {
  return function() {
    return c6.call(this.children, e);
  };
}
function f6(e) {
  return this.selectAll(e == null ? u6 : d6(typeof e == "function" ? e : Fg(e)));
}
function h6(e) {
  typeof e != "function" && (e = Vg(e));
  for (var t = this._groups, r = t.length, n = new Array(r), o = 0; o < r; ++o)
    for (var s = t[o], i = s.length, l = n[o] = [], c, u = 0; u < i; ++u)
      (c = s[u]) && e.call(c, c.__data__, u, s) && l.push(c);
  return new gr(n, this._parents);
}
function Zg(e) {
  return new Array(e.length);
}
function p6() {
  return new gr(this._enter || this._groups.map(Zg), this._parents);
}
function pa(e, t) {
  this.ownerDocument = e.ownerDocument, this.namespaceURI = e.namespaceURI, this._next = null, this._parent = e, this.__data__ = t;
}
pa.prototype = {
  constructor: pa,
  appendChild: function(e) {
    return this._parent.insertBefore(e, this._next);
  },
  insertBefore: function(e, t) {
    return this._parent.insertBefore(e, t);
  },
  querySelector: function(e) {
    return this._parent.querySelector(e);
  },
  querySelectorAll: function(e) {
    return this._parent.querySelectorAll(e);
  }
};
function v6(e) {
  return function() {
    return e;
  };
}
function g6(e, t, r, n, o, s) {
  for (var i = 0, l, c = t.length, u = s.length; i < u; ++i)
    (l = t[i]) ? (l.__data__ = s[i], n[i] = l) : r[i] = new pa(e, s[i]);
  for (; i < c; ++i)
    (l = t[i]) && (o[i] = l);
}
function m6(e, t, r, n, o, s, i) {
  var l, c, u = /* @__PURE__ */ new Map(), d = t.length, f = s.length, h = new Array(d), p;
  for (l = 0; l < d; ++l)
    (c = t[l]) && (h[l] = p = i.call(c, c.__data__, l, t) + "", u.has(p) ? o[l] = c : u.set(p, c));
  for (l = 0; l < f; ++l)
    p = i.call(e, s[l], l, s) + "", (c = u.get(p)) ? (n[l] = c, c.__data__ = s[l], u.delete(p)) : r[l] = new pa(e, s[l]);
  for (l = 0; l < d; ++l)
    (c = t[l]) && u.get(h[l]) === c && (o[l] = c);
}
function b6(e) {
  return e.__data__;
}
function x6(e, t) {
  if (!arguments.length) return Array.from(this, b6);
  var r = t ? m6 : g6, n = this._parents, o = this._groups;
  typeof e != "function" && (e = v6(e));
  for (var s = o.length, i = new Array(s), l = new Array(s), c = new Array(s), u = 0; u < s; ++u) {
    var d = n[u], f = o[u], h = f.length, p = y6(e.call(d, d && d.__data__, u, n)), v = p.length, g = l[u] = new Array(v), y = i[u] = new Array(v), _ = c[u] = new Array(h);
    r(d, f, g, y, _, p, t);
    for (var k = 0, S = 0, b, $; k < v; ++k)
      if (b = g[k]) {
        for (k >= S && (S = k + 1); !($ = y[S]) && ++S < v; ) ;
        b._next = $ || null;
      }
  }
  return i = new gr(i, n), i._enter = l, i._exit = c, i;
}
function y6(e) {
  return typeof e == "object" && "length" in e ? e : Array.from(e);
}
function _6() {
  return new gr(this._exit || this._groups.map(Zg), this._parents);
}
function w6(e, t, r) {
  var n = this.enter(), o = this, s = this.exit();
  return typeof e == "function" ? (n = e(n), n && (n = n.selection())) : n = n.append(e + ""), t != null && (o = t(o), o && (o = o.selection())), r == null ? s.remove() : r(s), n && o ? n.merge(o).order() : o;
}
function k6(e) {
  for (var t = e.selection ? e.selection() : e, r = this._groups, n = t._groups, o = r.length, s = n.length, i = Math.min(o, s), l = new Array(o), c = 0; c < i; ++c)
    for (var u = r[c], d = n[c], f = u.length, h = l[c] = new Array(f), p, v = 0; v < f; ++v)
      (p = u[v] || d[v]) && (h[v] = p);
  for (; c < o; ++c)
    l[c] = r[c];
  return new gr(l, this._parents);
}
function S6() {
  for (var e = this._groups, t = -1, r = e.length; ++t < r; )
    for (var n = e[t], o = n.length - 1, s = n[o], i; --o >= 0; )
      (i = n[o]) && (s && i.compareDocumentPosition(s) ^ 4 && s.parentNode.insertBefore(i, s), s = i);
  return this;
}
function $6(e) {
  e || (e = z6);
  function t(f, h) {
    return f && h ? e(f.__data__, h.__data__) : !f - !h;
  }
  for (var r = this._groups, n = r.length, o = new Array(n), s = 0; s < n; ++s) {
    for (var i = r[s], l = i.length, c = o[s] = new Array(l), u, d = 0; d < l; ++d)
      (u = i[d]) && (c[d] = u);
    c.sort(t);
  }
  return new gr(o, this._parents).order();
}
function z6(e, t) {
  return e < t ? -1 : e > t ? 1 : e >= t ? 0 : NaN;
}
function A6() {
  var e = arguments[0];
  return arguments[0] = this, e.apply(null, arguments), this;
}
function E6() {
  return Array.from(this);
}
function M6() {
  for (var e = this._groups, t = 0, r = e.length; t < r; ++t)
    for (var n = e[t], o = 0, s = n.length; o < s; ++o) {
      var i = n[o];
      if (i) return i;
    }
  return null;
}
function T6() {
  let e = 0;
  for (const t of this) ++e;
  return e;
}
function C6() {
  return !this.node();
}
function O6(e) {
  for (var t = this._groups, r = 0, n = t.length; r < n; ++r)
    for (var o = t[r], s = 0, i = o.length, l; s < i; ++s)
      (l = o[s]) && e.call(l, l.__data__, s, o);
  return this;
}
function N6(e) {
  return function() {
    this.removeAttribute(e);
  };
}
function P6(e) {
  return function() {
    this.removeAttributeNS(e.space, e.local);
  };
}
function I6(e, t) {
  return function() {
    this.setAttribute(e, t);
  };
}
function R6(e, t) {
  return function() {
    this.setAttributeNS(e.space, e.local, t);
  };
}
function D6(e, t) {
  return function() {
    var r = t.apply(this, arguments);
    r == null ? this.removeAttribute(e) : this.setAttribute(e, r);
  };
}
function L6(e, t) {
  return function() {
    var r = t.apply(this, arguments);
    r == null ? this.removeAttributeNS(e.space, e.local) : this.setAttributeNS(e.space, e.local, r);
  };
}
function j6(e, t) {
  var r = Da(e);
  if (arguments.length < 2) {
    var n = this.node();
    return r.local ? n.getAttributeNS(r.space, r.local) : n.getAttribute(r);
  }
  return this.each((t == null ? r.local ? P6 : N6 : typeof t == "function" ? r.local ? L6 : D6 : r.local ? R6 : I6)(r, t));
}
function Ug(e) {
  return e.ownerDocument && e.ownerDocument.defaultView || e.document && e || e.defaultView;
}
function V6(e) {
  return function() {
    this.style.removeProperty(e);
  };
}
function F6(e, t, r) {
  return function() {
    this.style.setProperty(e, t, r);
  };
}
function Z6(e, t, r) {
  return function() {
    var n = t.apply(this, arguments);
    n == null ? this.style.removeProperty(e) : this.style.setProperty(e, n, r);
  };
}
function U6(e, t, r) {
  return arguments.length > 1 ? this.each((t == null ? V6 : typeof t == "function" ? Z6 : F6)(e, t, r ?? "")) : Jo(this.node(), e);
}
function Jo(e, t) {
  return e.style.getPropertyValue(t) || Ug(e).getComputedStyle(e, null).getPropertyValue(t);
}
function B6(e) {
  return function() {
    delete this[e];
  };
}
function W6(e, t) {
  return function() {
    this[e] = t;
  };
}
function H6(e, t) {
  return function() {
    var r = t.apply(this, arguments);
    r == null ? delete this[e] : this[e] = r;
  };
}
function q6(e, t) {
  return arguments.length > 1 ? this.each((t == null ? B6 : typeof t == "function" ? H6 : W6)(e, t)) : this.node()[e];
}
function Bg(e) {
  return e.trim().split(/^|\s+/);
}
function Vu(e) {
  return e.classList || new Wg(e);
}
function Wg(e) {
  this._node = e, this._names = Bg(e.getAttribute("class") || "");
}
Wg.prototype = {
  add: function(e) {
    var t = this._names.indexOf(e);
    t < 0 && (this._names.push(e), this._node.setAttribute("class", this._names.join(" ")));
  },
  remove: function(e) {
    var t = this._names.indexOf(e);
    t >= 0 && (this._names.splice(t, 1), this._node.setAttribute("class", this._names.join(" ")));
  },
  contains: function(e) {
    return this._names.indexOf(e) >= 0;
  }
};
function Hg(e, t) {
  for (var r = Vu(e), n = -1, o = t.length; ++n < o; ) r.add(t[n]);
}
function qg(e, t) {
  for (var r = Vu(e), n = -1, o = t.length; ++n < o; ) r.remove(t[n]);
}
function G6(e) {
  return function() {
    Hg(this, e);
  };
}
function K6(e) {
  return function() {
    qg(this, e);
  };
}
function Y6(e, t) {
  return function() {
    (t.apply(this, arguments) ? Hg : qg)(this, e);
  };
}
function X6(e, t) {
  var r = Bg(e + "");
  if (arguments.length < 2) {
    for (var n = Vu(this.node()), o = -1, s = r.length; ++o < s; ) if (!n.contains(r[o])) return !1;
    return !0;
  }
  return this.each((typeof t == "function" ? Y6 : t ? G6 : K6)(r, t));
}
function J6() {
  this.textContent = "";
}
function Q6(e) {
  return function() {
    this.textContent = e;
  };
}
function eA(e) {
  return function() {
    var t = e.apply(this, arguments);
    this.textContent = t ?? "";
  };
}
function tA(e) {
  return arguments.length ? this.each(e == null ? J6 : (typeof e == "function" ? eA : Q6)(e)) : this.node().textContent;
}
function rA() {
  this.innerHTML = "";
}
function nA(e) {
  return function() {
    this.innerHTML = e;
  };
}
function oA(e) {
  return function() {
    var t = e.apply(this, arguments);
    this.innerHTML = t ?? "";
  };
}
function sA(e) {
  return arguments.length ? this.each(e == null ? rA : (typeof e == "function" ? oA : nA)(e)) : this.node().innerHTML;
}
function iA() {
  this.nextSibling && this.parentNode.appendChild(this);
}
function aA() {
  return this.each(iA);
}
function lA() {
  this.previousSibling && this.parentNode.insertBefore(this, this.parentNode.firstChild);
}
function cA() {
  return this.each(lA);
}
function uA(e) {
  var t = typeof e == "function" ? e : Lg(e);
  return this.select(function() {
    return this.appendChild(t.apply(this, arguments));
  });
}
function dA() {
  return null;
}
function fA(e, t) {
  var r = typeof e == "function" ? e : Lg(e), n = t == null ? dA : typeof t == "function" ? t : ju(t);
  return this.select(function() {
    return this.insertBefore(r.apply(this, arguments), n.apply(this, arguments) || null);
  });
}
function hA() {
  var e = this.parentNode;
  e && e.removeChild(this);
}
function pA() {
  return this.each(hA);
}
function vA() {
  var e = this.cloneNode(!1), t = this.parentNode;
  return t ? t.insertBefore(e, this.nextSibling) : e;
}
function gA() {
  var e = this.cloneNode(!0), t = this.parentNode;
  return t ? t.insertBefore(e, this.nextSibling) : e;
}
function mA(e) {
  return this.select(e ? gA : vA);
}
function bA(e) {
  return arguments.length ? this.property("__data__", e) : this.node().__data__;
}
function xA(e) {
  return function(t) {
    e.call(this, t, this.__data__);
  };
}
function yA(e) {
  return e.trim().split(/^|\s+/).map(function(t) {
    var r = "", n = t.indexOf(".");
    return n >= 0 && (r = t.slice(n + 1), t = t.slice(0, n)), { type: t, name: r };
  });
}
function _A(e) {
  return function() {
    var t = this.__on;
    if (t) {
      for (var r = 0, n = -1, o = t.length, s; r < o; ++r)
        s = t[r], (!e.type || s.type === e.type) && s.name === e.name ? this.removeEventListener(s.type, s.listener, s.options) : t[++n] = s;
      ++n ? t.length = n : delete this.__on;
    }
  };
}
function wA(e, t, r) {
  return function() {
    var n = this.__on, o, s = xA(t);
    if (n) {
      for (var i = 0, l = n.length; i < l; ++i)
        if ((o = n[i]).type === e.type && o.name === e.name) {
          this.removeEventListener(o.type, o.listener, o.options), this.addEventListener(o.type, o.listener = s, o.options = r), o.value = t;
          return;
        }
    }
    this.addEventListener(e.type, s, r), o = { type: e.type, name: e.name, value: t, listener: s, options: r }, n ? n.push(o) : this.__on = [o];
  };
}
function kA(e, t, r) {
  var n = yA(e + ""), o, s = n.length, i;
  if (arguments.length < 2) {
    var l = this.node().__on;
    if (l) {
      for (var c = 0, u = l.length, d; c < u; ++c)
        for (o = 0, d = l[c]; o < s; ++o)
          if ((i = n[o]).type === d.type && i.name === d.name)
            return d.value;
    }
    return;
  }
  for (l = t ? wA : _A, o = 0; o < s; ++o) this.each(l(n[o], t, r));
  return this;
}
function Gg(e, t, r) {
  var n = Ug(e), o = n.CustomEvent;
  typeof o == "function" ? o = new o(t, r) : (o = n.document.createEvent("Event"), r ? (o.initEvent(t, r.bubbles, r.cancelable), o.detail = r.detail) : o.initEvent(t, !1, !1)), e.dispatchEvent(o);
}
function SA(e, t) {
  return function() {
    return Gg(this, e, t);
  };
}
function $A(e, t) {
  return function() {
    return Gg(this, e, t.apply(this, arguments));
  };
}
function zA(e, t) {
  return this.each((typeof t == "function" ? $A : SA)(e, t));
}
function* AA() {
  for (var e = this._groups, t = 0, r = e.length; t < r; ++t)
    for (var n = e[t], o = 0, s = n.length, i; o < s; ++o)
      (i = n[o]) && (yield i);
}
var Kg = [null];
function gr(e, t) {
  this._groups = e, this._parents = t;
}
function oi() {
  return new gr([[document.documentElement]], Kg);
}
function EA() {
  return this;
}
gr.prototype = oi.prototype = {
  constructor: gr,
  select: e6,
  selectAll: o6,
  selectChild: l6,
  selectChildren: f6,
  filter: h6,
  data: x6,
  enter: p6,
  exit: _6,
  join: w6,
  merge: k6,
  selection: EA,
  order: S6,
  sort: $6,
  call: A6,
  nodes: E6,
  node: M6,
  size: T6,
  empty: C6,
  each: O6,
  attr: j6,
  style: U6,
  property: q6,
  classed: X6,
  text: tA,
  html: sA,
  raise: aA,
  lower: cA,
  append: uA,
  insert: fA,
  remove: pA,
  clone: mA,
  datum: bA,
  on: kA,
  dispatch: zA,
  [Symbol.iterator]: AA
};
function dr(e) {
  return typeof e == "string" ? new gr([[document.querySelector(e)]], [document.documentElement]) : new gr([[e]], Kg);
}
function MA(e) {
  let t;
  for (; t = e.sourceEvent; ) e = t;
  return e;
}
function hn(e, t) {
  if (e = MA(e), t === void 0 && (t = e.currentTarget), t) {
    var r = t.ownerSVGElement || t;
    if (r.createSVGPoint) {
      var n = r.createSVGPoint();
      return n.x = e.clientX, n.y = e.clientY, n = n.matrixTransform(t.getScreenCTM().inverse()), [n.x, n.y];
    }
    if (t.getBoundingClientRect) {
      var o = t.getBoundingClientRect();
      return [e.clientX - o.left - t.clientLeft, e.clientY - o.top - t.clientTop];
    }
  }
  return [e.pageX, e.pageY];
}
const TA = { passive: !1 }, Ds = { capture: !0, passive: !1 };
function ul(e) {
  e.stopImmediatePropagation();
}
function Io(e) {
  e.preventDefault(), e.stopImmediatePropagation();
}
function Yg(e) {
  var t = e.document.documentElement, r = dr(e).on("dragstart.drag", Io, Ds);
  "onselectstart" in t ? r.on("selectstart.drag", Io, Ds) : (t.__noselect = t.style.MozUserSelect, t.style.MozUserSelect = "none");
}
function Xg(e, t) {
  var r = e.document.documentElement, n = dr(e).on("dragstart.drag", null);
  t && (n.on("click.drag", Io, Ds), setTimeout(function() {
    n.on("click.drag", null);
  }, 0)), "onselectstart" in r ? n.on("selectstart.drag", null) : (r.style.MozUserSelect = r.__noselect, delete r.__noselect);
}
const $i = (e) => () => e;
function ac(e, {
  sourceEvent: t,
  subject: r,
  target: n,
  identifier: o,
  active: s,
  x: i,
  y: l,
  dx: c,
  dy: u,
  dispatch: d
}) {
  Object.defineProperties(this, {
    type: { value: e, enumerable: !0, configurable: !0 },
    sourceEvent: { value: t, enumerable: !0, configurable: !0 },
    subject: { value: r, enumerable: !0, configurable: !0 },
    target: { value: n, enumerable: !0, configurable: !0 },
    identifier: { value: o, enumerable: !0, configurable: !0 },
    active: { value: s, enumerable: !0, configurable: !0 },
    x: { value: i, enumerable: !0, configurable: !0 },
    y: { value: l, enumerable: !0, configurable: !0 },
    dx: { value: c, enumerable: !0, configurable: !0 },
    dy: { value: u, enumerable: !0, configurable: !0 },
    _: { value: d }
  });
}
ac.prototype.on = function() {
  var e = this._.on.apply(this._, arguments);
  return e === this._ ? this : e;
};
function CA(e) {
  return !e.ctrlKey && !e.button;
}
function OA() {
  return this.parentNode;
}
function NA(e, t) {
  return t ?? { x: e.x, y: e.y };
}
function PA() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function IA() {
  var e = CA, t = OA, r = NA, n = PA, o = {}, s = ni("start", "drag", "end"), i = 0, l, c, u, d, f = 0;
  function h(b) {
    b.on("mousedown.drag", p).filter(n).on("touchstart.drag", y).on("touchmove.drag", _, TA).on("touchend.drag touchcancel.drag", k).style("touch-action", "none").style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  function p(b, $) {
    if (!(d || !e.call(this, b, $))) {
      var E = S(this, t.call(this, b, $), b, $, "mouse");
      E && (dr(b.view).on("mousemove.drag", v, Ds).on("mouseup.drag", g, Ds), Yg(b.view), ul(b), u = !1, l = b.clientX, c = b.clientY, E("start", b));
    }
  }
  function v(b) {
    if (Io(b), !u) {
      var $ = b.clientX - l, E = b.clientY - c;
      u = $ * $ + E * E > f;
    }
    o.mouse("drag", b);
  }
  function g(b) {
    dr(b.view).on("mousemove.drag mouseup.drag", null), Xg(b.view, u), Io(b), o.mouse("end", b);
  }
  function y(b, $) {
    if (e.call(this, b, $)) {
      var E = b.changedTouches, C = t.call(this, b, $), w = E.length, O, A;
      for (O = 0; O < w; ++O)
        (A = S(this, C, b, $, E[O].identifier, E[O])) && (ul(b), A("start", b, E[O]));
    }
  }
  function _(b) {
    var $ = b.changedTouches, E = $.length, C, w;
    for (C = 0; C < E; ++C)
      (w = o[$[C].identifier]) && (Io(b), w("drag", b, $[C]));
  }
  function k(b) {
    var $ = b.changedTouches, E = $.length, C, w;
    for (d && clearTimeout(d), d = setTimeout(function() {
      d = null;
    }, 500), C = 0; C < E; ++C)
      (w = o[$[C].identifier]) && (ul(b), w("end", b, $[C]));
  }
  function S(b, $, E, C, w, O) {
    var A = s.copy(), R = hn(O || E, $), W, q, P;
    if ((P = r.call(b, new ac("beforestart", {
      sourceEvent: E,
      target: h,
      identifier: w,
      active: i,
      x: R[0],
      y: R[1],
      dx: 0,
      dy: 0,
      dispatch: A
    }), C)) != null)
      return W = P.x - R[0] || 0, q = P.y - R[1] || 0, function H(V, Y, oe) {
        var X = R, I;
        switch (V) {
          case "start":
            o[w] = H, I = i++;
            break;
          case "end":
            delete o[w], --i;
          // falls through
          case "drag":
            R = hn(oe || Y, $), I = i;
            break;
        }
        A.call(
          V,
          b,
          new ac(V, {
            sourceEvent: Y,
            subject: P,
            target: h,
            identifier: w,
            active: I,
            x: R[0] + W,
            y: R[1] + q,
            dx: R[0] - X[0],
            dy: R[1] - X[1],
            dispatch: A
          }),
          C
        );
      };
  }
  return h.filter = function(b) {
    return arguments.length ? (e = typeof b == "function" ? b : $i(!!b), h) : e;
  }, h.container = function(b) {
    return arguments.length ? (t = typeof b == "function" ? b : $i(b), h) : t;
  }, h.subject = function(b) {
    return arguments.length ? (r = typeof b == "function" ? b : $i(b), h) : r;
  }, h.touchable = function(b) {
    return arguments.length ? (n = typeof b == "function" ? b : $i(!!b), h) : n;
  }, h.on = function() {
    var b = s.on.apply(s, arguments);
    return b === s ? h : b;
  }, h.clickDistance = function(b) {
    return arguments.length ? (f = (b = +b) * b, h) : Math.sqrt(f);
  }, h;
}
var RA = ni("start", "end", "cancel", "interrupt"), DA = [], Jg = 0, Tf = 1, lc = 2, Vi = 3, Cf = 4, cc = 5, Fi = 6;
function La(e, t, r, n, o, s) {
  var i = e.__transition;
  if (!i) e.__transition = {};
  else if (r in i) return;
  LA(e, r, {
    name: t,
    index: n,
    // For context during callback.
    group: o,
    // For context during callback.
    on: RA,
    tween: DA,
    time: s.time,
    delay: s.delay,
    duration: s.duration,
    ease: s.ease,
    timer: null,
    state: Jg
  });
}
function Fu(e, t) {
  var r = Br(e, t);
  if (r.state > Jg) throw new Error("too late; already scheduled");
  return r;
}
function an(e, t) {
  var r = Br(e, t);
  if (r.state > Vi) throw new Error("too late; already running");
  return r;
}
function Br(e, t) {
  var r = e.__transition;
  if (!r || !(r = r[t])) throw new Error("transition not found");
  return r;
}
function LA(e, t, r) {
  var n = e.__transition, o;
  n[t] = r, r.timer = Lu(s, 0, r.time);
  function s(u) {
    r.state = Tf, r.timer.restart(i, r.delay, r.time), r.delay <= u && i(u - r.delay);
  }
  function i(u) {
    var d, f, h, p;
    if (r.state !== Tf) return c();
    for (d in n)
      if (p = n[d], p.name === r.name) {
        if (p.state === Vi) return Af(i);
        p.state === Cf ? (p.state = Fi, p.timer.stop(), p.on.call("interrupt", e, e.__data__, p.index, p.group), delete n[d]) : +d < t && (p.state = Fi, p.timer.stop(), p.on.call("cancel", e, e.__data__, p.index, p.group), delete n[d]);
      }
    if (Af(function() {
      r.state === Vi && (r.state = Cf, r.timer.restart(l, r.delay, r.time), l(u));
    }), r.state = lc, r.on.call("start", e, e.__data__, r.index, r.group), r.state === lc) {
      for (r.state = Vi, o = new Array(h = r.tween.length), d = 0, f = -1; d < h; ++d)
        (p = r.tween[d].value.call(e, e.__data__, r.index, r.group)) && (o[++f] = p);
      o.length = f + 1;
    }
  }
  function l(u) {
    for (var d = u < r.duration ? r.ease.call(null, u / r.duration) : (r.timer.restart(c), r.state = cc, 1), f = -1, h = o.length; ++f < h; )
      o[f].call(e, d);
    r.state === cc && (r.on.call("end", e, e.__data__, r.index, r.group), c());
  }
  function c() {
    r.state = Fi, r.timer.stop(), delete n[t];
    for (var u in n) return;
    delete e.__transition;
  }
}
function Zi(e, t) {
  var r = e.__transition, n, o, s = !0, i;
  if (r) {
    t = t == null ? null : t + "";
    for (i in r) {
      if ((n = r[i]).name !== t) {
        s = !1;
        continue;
      }
      o = n.state > lc && n.state < cc, n.state = Fi, n.timer.stop(), n.on.call(o ? "interrupt" : "cancel", e, e.__data__, n.index, n.group), delete r[i];
    }
    s && delete e.__transition;
  }
}
function jA(e) {
  return this.each(function() {
    Zi(this, e);
  });
}
function Zu(e, t, r) {
  e.prototype = t.prototype = r, r.constructor = e;
}
function Qg(e, t) {
  var r = Object.create(e.prototype);
  for (var n in t) r[n] = t[n];
  return r;
}
function si() {
}
var Ls = 0.7, va = 1 / Ls, Ro = "\\s*([+-]?\\d+)\\s*", js = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*", nn = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*", VA = /^#([0-9a-f]{3,8})$/, FA = new RegExp(`^rgb\\(${Ro},${Ro},${Ro}\\)$`), ZA = new RegExp(`^rgb\\(${nn},${nn},${nn}\\)$`), UA = new RegExp(`^rgba\\(${Ro},${Ro},${Ro},${js}\\)$`), BA = new RegExp(`^rgba\\(${nn},${nn},${nn},${js}\\)$`), WA = new RegExp(`^hsl\\(${js},${nn},${nn}\\)$`), HA = new RegExp(`^hsla\\(${js},${nn},${nn},${js}\\)$`), Of = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkgrey: 11119017,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkslategrey: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgray: 6908265,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategray: 7372944,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
Zu(si, Vs, {
  copy(e) {
    return Object.assign(new this.constructor(), this, e);
  },
  displayable() {
    return this.rgb().displayable();
  },
  hex: Nf,
  // Deprecated! Use color.formatHex.
  formatHex: Nf,
  formatHex8: qA,
  formatHsl: GA,
  formatRgb: Pf,
  toString: Pf
});
function Nf() {
  return this.rgb().formatHex();
}
function qA() {
  return this.rgb().formatHex8();
}
function GA() {
  return em(this).formatHsl();
}
function Pf() {
  return this.rgb().formatRgb();
}
function Vs(e) {
  var t, r;
  return e = (e + "").trim().toLowerCase(), (t = VA.exec(e)) ? (r = t[1].length, t = parseInt(t[1], 16), r === 6 ? If(t) : r === 3 ? new nr(t >> 8 & 15 | t >> 4 & 240, t >> 4 & 15 | t & 240, (t & 15) << 4 | t & 15, 1) : r === 8 ? zi(t >> 24 & 255, t >> 16 & 255, t >> 8 & 255, (t & 255) / 255) : r === 4 ? zi(t >> 12 & 15 | t >> 8 & 240, t >> 8 & 15 | t >> 4 & 240, t >> 4 & 15 | t & 240, ((t & 15) << 4 | t & 15) / 255) : null) : (t = FA.exec(e)) ? new nr(t[1], t[2], t[3], 1) : (t = ZA.exec(e)) ? new nr(t[1] * 255 / 100, t[2] * 255 / 100, t[3] * 255 / 100, 1) : (t = UA.exec(e)) ? zi(t[1], t[2], t[3], t[4]) : (t = BA.exec(e)) ? zi(t[1] * 255 / 100, t[2] * 255 / 100, t[3] * 255 / 100, t[4]) : (t = WA.exec(e)) ? Lf(t[1], t[2] / 100, t[3] / 100, 1) : (t = HA.exec(e)) ? Lf(t[1], t[2] / 100, t[3] / 100, t[4]) : Of.hasOwnProperty(e) ? If(Of[e]) : e === "transparent" ? new nr(NaN, NaN, NaN, 0) : null;
}
function If(e) {
  return new nr(e >> 16 & 255, e >> 8 & 255, e & 255, 1);
}
function zi(e, t, r, n) {
  return n <= 0 && (e = t = r = NaN), new nr(e, t, r, n);
}
function KA(e) {
  return e instanceof si || (e = Vs(e)), e ? (e = e.rgb(), new nr(e.r, e.g, e.b, e.opacity)) : new nr();
}
function uc(e, t, r, n) {
  return arguments.length === 1 ? KA(e) : new nr(e, t, r, n ?? 1);
}
function nr(e, t, r, n) {
  this.r = +e, this.g = +t, this.b = +r, this.opacity = +n;
}
Zu(nr, uc, Qg(si, {
  brighter(e) {
    return e = e == null ? va : Math.pow(va, e), new nr(this.r * e, this.g * e, this.b * e, this.opacity);
  },
  darker(e) {
    return e = e == null ? Ls : Math.pow(Ls, e), new nr(this.r * e, this.g * e, this.b * e, this.opacity);
  },
  rgb() {
    return this;
  },
  clamp() {
    return new nr(vo(this.r), vo(this.g), vo(this.b), ga(this.opacity));
  },
  displayable() {
    return -0.5 <= this.r && this.r < 255.5 && -0.5 <= this.g && this.g < 255.5 && -0.5 <= this.b && this.b < 255.5 && 0 <= this.opacity && this.opacity <= 1;
  },
  hex: Rf,
  // Deprecated! Use color.formatHex.
  formatHex: Rf,
  formatHex8: YA,
  formatRgb: Df,
  toString: Df
}));
function Rf() {
  return `#${fo(this.r)}${fo(this.g)}${fo(this.b)}`;
}
function YA() {
  return `#${fo(this.r)}${fo(this.g)}${fo(this.b)}${fo((isNaN(this.opacity) ? 1 : this.opacity) * 255)}`;
}
function Df() {
  const e = ga(this.opacity);
  return `${e === 1 ? "rgb(" : "rgba("}${vo(this.r)}, ${vo(this.g)}, ${vo(this.b)}${e === 1 ? ")" : `, ${e})`}`;
}
function ga(e) {
  return isNaN(e) ? 1 : Math.max(0, Math.min(1, e));
}
function vo(e) {
  return Math.max(0, Math.min(255, Math.round(e) || 0));
}
function fo(e) {
  return e = vo(e), (e < 16 ? "0" : "") + e.toString(16);
}
function Lf(e, t, r, n) {
  return n <= 0 ? e = t = r = NaN : r <= 0 || r >= 1 ? e = t = NaN : t <= 0 && (e = NaN), new Or(e, t, r, n);
}
function em(e) {
  if (e instanceof Or) return new Or(e.h, e.s, e.l, e.opacity);
  if (e instanceof si || (e = Vs(e)), !e) return new Or();
  if (e instanceof Or) return e;
  e = e.rgb();
  var t = e.r / 255, r = e.g / 255, n = e.b / 255, o = Math.min(t, r, n), s = Math.max(t, r, n), i = NaN, l = s - o, c = (s + o) / 2;
  return l ? (t === s ? i = (r - n) / l + (r < n) * 6 : r === s ? i = (n - t) / l + 2 : i = (t - r) / l + 4, l /= c < 0.5 ? s + o : 2 - s - o, i *= 60) : l = c > 0 && c < 1 ? 0 : i, new Or(i, l, c, e.opacity);
}
function XA(e, t, r, n) {
  return arguments.length === 1 ? em(e) : new Or(e, t, r, n ?? 1);
}
function Or(e, t, r, n) {
  this.h = +e, this.s = +t, this.l = +r, this.opacity = +n;
}
Zu(Or, XA, Qg(si, {
  brighter(e) {
    return e = e == null ? va : Math.pow(va, e), new Or(this.h, this.s, this.l * e, this.opacity);
  },
  darker(e) {
    return e = e == null ? Ls : Math.pow(Ls, e), new Or(this.h, this.s, this.l * e, this.opacity);
  },
  rgb() {
    var e = this.h % 360 + (this.h < 0) * 360, t = isNaN(e) || isNaN(this.s) ? 0 : this.s, r = this.l, n = r + (r < 0.5 ? r : 1 - r) * t, o = 2 * r - n;
    return new nr(
      dl(e >= 240 ? e - 240 : e + 120, o, n),
      dl(e, o, n),
      dl(e < 120 ? e + 240 : e - 120, o, n),
      this.opacity
    );
  },
  clamp() {
    return new Or(jf(this.h), Ai(this.s), Ai(this.l), ga(this.opacity));
  },
  displayable() {
    return (0 <= this.s && this.s <= 1 || isNaN(this.s)) && 0 <= this.l && this.l <= 1 && 0 <= this.opacity && this.opacity <= 1;
  },
  formatHsl() {
    const e = ga(this.opacity);
    return `${e === 1 ? "hsl(" : "hsla("}${jf(this.h)}, ${Ai(this.s) * 100}%, ${Ai(this.l) * 100}%${e === 1 ? ")" : `, ${e})`}`;
  }
}));
function jf(e) {
  return e = (e || 0) % 360, e < 0 ? e + 360 : e;
}
function Ai(e) {
  return Math.max(0, Math.min(1, e || 0));
}
function dl(e, t, r) {
  return (e < 60 ? t + (r - t) * e / 60 : e < 180 ? r : e < 240 ? t + (r - t) * (240 - e) / 60 : t) * 255;
}
const tm = (e) => () => e;
function JA(e, t) {
  return function(r) {
    return e + r * t;
  };
}
function QA(e, t, r) {
  return e = Math.pow(e, r), t = Math.pow(t, r) - e, r = 1 / r, function(n) {
    return Math.pow(e + n * t, r);
  };
}
function eE(e) {
  return (e = +e) == 1 ? rm : function(t, r) {
    return r - t ? QA(t, r, e) : tm(isNaN(t) ? r : t);
  };
}
function rm(e, t) {
  var r = t - e;
  return r ? JA(e, r) : tm(isNaN(e) ? t : e);
}
const Vf = (function e(t) {
  var r = eE(t);
  function n(o, s) {
    var i = r((o = uc(o)).r, (s = uc(s)).r), l = r(o.g, s.g), c = r(o.b, s.b), u = rm(o.opacity, s.opacity);
    return function(d) {
      return o.r = i(d), o.g = l(d), o.b = c(d), o.opacity = u(d), o + "";
    };
  }
  return n.gamma = e, n;
})(1);
function Dn(e, t) {
  return e = +e, t = +t, function(r) {
    return e * (1 - r) + t * r;
  };
}
var dc = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g, fl = new RegExp(dc.source, "g");
function tE(e) {
  return function() {
    return e;
  };
}
function rE(e) {
  return function(t) {
    return e(t) + "";
  };
}
function nE(e, t) {
  var r = dc.lastIndex = fl.lastIndex = 0, n, o, s, i = -1, l = [], c = [];
  for (e = e + "", t = t + ""; (n = dc.exec(e)) && (o = fl.exec(t)); )
    (s = o.index) > r && (s = t.slice(r, s), l[i] ? l[i] += s : l[++i] = s), (n = n[0]) === (o = o[0]) ? l[i] ? l[i] += o : l[++i] = o : (l[++i] = null, c.push({ i, x: Dn(n, o) })), r = fl.lastIndex;
  return r < t.length && (s = t.slice(r), l[i] ? l[i] += s : l[++i] = s), l.length < 2 ? c[0] ? rE(c[0].x) : tE(t) : (t = c.length, function(u) {
    for (var d = 0, f; d < t; ++d) l[(f = c[d]).i] = f.x(u);
    return l.join("");
  });
}
var Ff = 180 / Math.PI, fc = {
  translateX: 0,
  translateY: 0,
  rotate: 0,
  skewX: 0,
  scaleX: 1,
  scaleY: 1
};
function nm(e, t, r, n, o, s) {
  var i, l, c;
  return (i = Math.sqrt(e * e + t * t)) && (e /= i, t /= i), (c = e * r + t * n) && (r -= e * c, n -= t * c), (l = Math.sqrt(r * r + n * n)) && (r /= l, n /= l, c /= l), e * n < t * r && (e = -e, t = -t, c = -c, i = -i), {
    translateX: o,
    translateY: s,
    rotate: Math.atan2(t, e) * Ff,
    skewX: Math.atan(c) * Ff,
    scaleX: i,
    scaleY: l
  };
}
var Ei;
function oE(e) {
  const t = new (typeof DOMMatrix == "function" ? DOMMatrix : WebKitCSSMatrix)(e + "");
  return t.isIdentity ? fc : nm(t.a, t.b, t.c, t.d, t.e, t.f);
}
function sE(e) {
  return e == null || (Ei || (Ei = document.createElementNS("http://www.w3.org/2000/svg", "g")), Ei.setAttribute("transform", e), !(e = Ei.transform.baseVal.consolidate())) ? fc : (e = e.matrix, nm(e.a, e.b, e.c, e.d, e.e, e.f));
}
function om(e, t, r, n) {
  function o(u) {
    return u.length ? u.pop() + " " : "";
  }
  function s(u, d, f, h, p, v) {
    if (u !== f || d !== h) {
      var g = p.push("translate(", null, t, null, r);
      v.push({ i: g - 4, x: Dn(u, f) }, { i: g - 2, x: Dn(d, h) });
    } else (f || h) && p.push("translate(" + f + t + h + r);
  }
  function i(u, d, f, h) {
    u !== d ? (u - d > 180 ? d += 360 : d - u > 180 && (u += 360), h.push({ i: f.push(o(f) + "rotate(", null, n) - 2, x: Dn(u, d) })) : d && f.push(o(f) + "rotate(" + d + n);
  }
  function l(u, d, f, h) {
    u !== d ? h.push({ i: f.push(o(f) + "skewX(", null, n) - 2, x: Dn(u, d) }) : d && f.push(o(f) + "skewX(" + d + n);
  }
  function c(u, d, f, h, p, v) {
    if (u !== f || d !== h) {
      var g = p.push(o(p) + "scale(", null, ",", null, ")");
      v.push({ i: g - 4, x: Dn(u, f) }, { i: g - 2, x: Dn(d, h) });
    } else (f !== 1 || h !== 1) && p.push(o(p) + "scale(" + f + "," + h + ")");
  }
  return function(u, d) {
    var f = [], h = [];
    return u = e(u), d = e(d), s(u.translateX, u.translateY, d.translateX, d.translateY, f, h), i(u.rotate, d.rotate, f, h), l(u.skewX, d.skewX, f, h), c(u.scaleX, u.scaleY, d.scaleX, d.scaleY, f, h), u = d = null, function(p) {
      for (var v = -1, g = h.length, y; ++v < g; ) f[(y = h[v]).i] = y.x(p);
      return f.join("");
    };
  };
}
var iE = om(oE, "px, ", "px)", "deg)"), aE = om(sE, ", ", ")", ")"), lE = 1e-12;
function Zf(e) {
  return ((e = Math.exp(e)) + 1 / e) / 2;
}
function cE(e) {
  return ((e = Math.exp(e)) - 1 / e) / 2;
}
function uE(e) {
  return ((e = Math.exp(2 * e)) - 1) / (e + 1);
}
const dE = (function e(t, r, n) {
  function o(s, i) {
    var l = s[0], c = s[1], u = s[2], d = i[0], f = i[1], h = i[2], p = d - l, v = f - c, g = p * p + v * v, y, _;
    if (g < lE)
      _ = Math.log(h / u) / t, y = function(C) {
        return [
          l + C * p,
          c + C * v,
          u * Math.exp(t * C * _)
        ];
      };
    else {
      var k = Math.sqrt(g), S = (h * h - u * u + n * g) / (2 * u * r * k), b = (h * h - u * u - n * g) / (2 * h * r * k), $ = Math.log(Math.sqrt(S * S + 1) - S), E = Math.log(Math.sqrt(b * b + 1) - b);
      _ = (E - $) / t, y = function(C) {
        var w = C * _, O = Zf($), A = u / (r * k) * (O * uE(t * w + $) - cE($));
        return [
          l + A * p,
          c + A * v,
          u * O / Zf(t * w + $)
        ];
      };
    }
    return y.duration = _ * 1e3 * t / Math.SQRT2, y;
  }
  return o.rho = function(s) {
    var i = Math.max(1e-3, +s), l = i * i, c = l * l;
    return e(i, l, c);
  }, o;
})(Math.SQRT2, 2, 4);
function fE(e, t) {
  var r, n;
  return function() {
    var o = an(this, e), s = o.tween;
    if (s !== r) {
      n = r = s;
      for (var i = 0, l = n.length; i < l; ++i)
        if (n[i].name === t) {
          n = n.slice(), n.splice(i, 1);
          break;
        }
    }
    o.tween = n;
  };
}
function hE(e, t, r) {
  var n, o;
  if (typeof r != "function") throw new Error();
  return function() {
    var s = an(this, e), i = s.tween;
    if (i !== n) {
      o = (n = i).slice();
      for (var l = { name: t, value: r }, c = 0, u = o.length; c < u; ++c)
        if (o[c].name === t) {
          o[c] = l;
          break;
        }
      c === u && o.push(l);
    }
    s.tween = o;
  };
}
function pE(e, t) {
  var r = this._id;
  if (e += "", arguments.length < 2) {
    for (var n = Br(this.node(), r).tween, o = 0, s = n.length, i; o < s; ++o)
      if ((i = n[o]).name === e)
        return i.value;
    return null;
  }
  return this.each((t == null ? fE : hE)(r, e, t));
}
function Uu(e, t, r) {
  var n = e._id;
  return e.each(function() {
    var o = an(this, n);
    (o.value || (o.value = {}))[t] = r.apply(this, arguments);
  }), function(o) {
    return Br(o, n).value[t];
  };
}
function sm(e, t) {
  var r;
  return (typeof t == "number" ? Dn : t instanceof Vs ? Vf : (r = Vs(t)) ? (t = r, Vf) : nE)(e, t);
}
function vE(e) {
  return function() {
    this.removeAttribute(e);
  };
}
function gE(e) {
  return function() {
    this.removeAttributeNS(e.space, e.local);
  };
}
function mE(e, t, r) {
  var n, o = r + "", s;
  return function() {
    var i = this.getAttribute(e);
    return i === o ? null : i === n ? s : s = t(n = i, r);
  };
}
function bE(e, t, r) {
  var n, o = r + "", s;
  return function() {
    var i = this.getAttributeNS(e.space, e.local);
    return i === o ? null : i === n ? s : s = t(n = i, r);
  };
}
function xE(e, t, r) {
  var n, o, s;
  return function() {
    var i, l = r(this), c;
    return l == null ? void this.removeAttribute(e) : (i = this.getAttribute(e), c = l + "", i === c ? null : i === n && c === o ? s : (o = c, s = t(n = i, l)));
  };
}
function yE(e, t, r) {
  var n, o, s;
  return function() {
    var i, l = r(this), c;
    return l == null ? void this.removeAttributeNS(e.space, e.local) : (i = this.getAttributeNS(e.space, e.local), c = l + "", i === c ? null : i === n && c === o ? s : (o = c, s = t(n = i, l)));
  };
}
function _E(e, t) {
  var r = Da(e), n = r === "transform" ? aE : sm;
  return this.attrTween(e, typeof t == "function" ? (r.local ? yE : xE)(r, n, Uu(this, "attr." + e, t)) : t == null ? (r.local ? gE : vE)(r) : (r.local ? bE : mE)(r, n, t));
}
function wE(e, t) {
  return function(r) {
    this.setAttribute(e, t.call(this, r));
  };
}
function kE(e, t) {
  return function(r) {
    this.setAttributeNS(e.space, e.local, t.call(this, r));
  };
}
function SE(e, t) {
  var r, n;
  function o() {
    var s = t.apply(this, arguments);
    return s !== n && (r = (n = s) && kE(e, s)), r;
  }
  return o._value = t, o;
}
function $E(e, t) {
  var r, n;
  function o() {
    var s = t.apply(this, arguments);
    return s !== n && (r = (n = s) && wE(e, s)), r;
  }
  return o._value = t, o;
}
function zE(e, t) {
  var r = "attr." + e;
  if (arguments.length < 2) return (r = this.tween(r)) && r._value;
  if (t == null) return this.tween(r, null);
  if (typeof t != "function") throw new Error();
  var n = Da(e);
  return this.tween(r, (n.local ? SE : $E)(n, t));
}
function AE(e, t) {
  return function() {
    Fu(this, e).delay = +t.apply(this, arguments);
  };
}
function EE(e, t) {
  return t = +t, function() {
    Fu(this, e).delay = t;
  };
}
function ME(e) {
  var t = this._id;
  return arguments.length ? this.each((typeof e == "function" ? AE : EE)(t, e)) : Br(this.node(), t).delay;
}
function TE(e, t) {
  return function() {
    an(this, e).duration = +t.apply(this, arguments);
  };
}
function CE(e, t) {
  return t = +t, function() {
    an(this, e).duration = t;
  };
}
function OE(e) {
  var t = this._id;
  return arguments.length ? this.each((typeof e == "function" ? TE : CE)(t, e)) : Br(this.node(), t).duration;
}
function NE(e, t) {
  if (typeof t != "function") throw new Error();
  return function() {
    an(this, e).ease = t;
  };
}
function PE(e) {
  var t = this._id;
  return arguments.length ? this.each(NE(t, e)) : Br(this.node(), t).ease;
}
function IE(e, t) {
  return function() {
    var r = t.apply(this, arguments);
    if (typeof r != "function") throw new Error();
    an(this, e).ease = r;
  };
}
function RE(e) {
  if (typeof e != "function") throw new Error();
  return this.each(IE(this._id, e));
}
function DE(e) {
  typeof e != "function" && (e = Vg(e));
  for (var t = this._groups, r = t.length, n = new Array(r), o = 0; o < r; ++o)
    for (var s = t[o], i = s.length, l = n[o] = [], c, u = 0; u < i; ++u)
      (c = s[u]) && e.call(c, c.__data__, u, s) && l.push(c);
  return new $n(n, this._parents, this._name, this._id);
}
function LE(e) {
  if (e._id !== this._id) throw new Error();
  for (var t = this._groups, r = e._groups, n = t.length, o = r.length, s = Math.min(n, o), i = new Array(n), l = 0; l < s; ++l)
    for (var c = t[l], u = r[l], d = c.length, f = i[l] = new Array(d), h, p = 0; p < d; ++p)
      (h = c[p] || u[p]) && (f[p] = h);
  for (; l < n; ++l)
    i[l] = t[l];
  return new $n(i, this._parents, this._name, this._id);
}
function jE(e) {
  return (e + "").trim().split(/^|\s+/).every(function(t) {
    var r = t.indexOf(".");
    return r >= 0 && (t = t.slice(0, r)), !t || t === "start";
  });
}
function VE(e, t, r) {
  var n, o, s = jE(t) ? Fu : an;
  return function() {
    var i = s(this, e), l = i.on;
    l !== n && (o = (n = l).copy()).on(t, r), i.on = o;
  };
}
function FE(e, t) {
  var r = this._id;
  return arguments.length < 2 ? Br(this.node(), r).on.on(e) : this.each(VE(r, e, t));
}
function ZE(e) {
  return function() {
    var t = this.parentNode;
    for (var r in this.__transition) if (+r !== e) return;
    t && t.removeChild(this);
  };
}
function UE() {
  return this.on("end.remove", ZE(this._id));
}
function BE(e) {
  var t = this._name, r = this._id;
  typeof e != "function" && (e = ju(e));
  for (var n = this._groups, o = n.length, s = new Array(o), i = 0; i < o; ++i)
    for (var l = n[i], c = l.length, u = s[i] = new Array(c), d, f, h = 0; h < c; ++h)
      (d = l[h]) && (f = e.call(d, d.__data__, h, l)) && ("__data__" in d && (f.__data__ = d.__data__), u[h] = f, La(u[h], t, r, h, u, Br(d, r)));
  return new $n(s, this._parents, t, r);
}
function WE(e) {
  var t = this._name, r = this._id;
  typeof e != "function" && (e = jg(e));
  for (var n = this._groups, o = n.length, s = [], i = [], l = 0; l < o; ++l)
    for (var c = n[l], u = c.length, d, f = 0; f < u; ++f)
      if (d = c[f]) {
        for (var h = e.call(d, d.__data__, f, c), p, v = Br(d, r), g = 0, y = h.length; g < y; ++g)
          (p = h[g]) && La(p, t, r, g, h, v);
        s.push(h), i.push(d);
      }
  return new $n(s, i, t, r);
}
var HE = oi.prototype.constructor;
function qE() {
  return new HE(this._groups, this._parents);
}
function GE(e, t) {
  var r, n, o;
  return function() {
    var s = Jo(this, e), i = (this.style.removeProperty(e), Jo(this, e));
    return s === i ? null : s === r && i === n ? o : o = t(r = s, n = i);
  };
}
function im(e) {
  return function() {
    this.style.removeProperty(e);
  };
}
function KE(e, t, r) {
  var n, o = r + "", s;
  return function() {
    var i = Jo(this, e);
    return i === o ? null : i === n ? s : s = t(n = i, r);
  };
}
function YE(e, t, r) {
  var n, o, s;
  return function() {
    var i = Jo(this, e), l = r(this), c = l + "";
    return l == null && (c = l = (this.style.removeProperty(e), Jo(this, e))), i === c ? null : i === n && c === o ? s : (o = c, s = t(n = i, l));
  };
}
function XE(e, t) {
  var r, n, o, s = "style." + t, i = "end." + s, l;
  return function() {
    var c = an(this, e), u = c.on, d = c.value[s] == null ? l || (l = im(t)) : void 0;
    (u !== r || o !== d) && (n = (r = u).copy()).on(i, o = d), c.on = n;
  };
}
function JE(e, t, r) {
  var n = (e += "") == "transform" ? iE : sm;
  return t == null ? this.styleTween(e, GE(e, n)).on("end.style." + e, im(e)) : typeof t == "function" ? this.styleTween(e, YE(e, n, Uu(this, "style." + e, t))).each(XE(this._id, e)) : this.styleTween(e, KE(e, n, t), r).on("end.style." + e, null);
}
function QE(e, t, r) {
  return function(n) {
    this.style.setProperty(e, t.call(this, n), r);
  };
}
function eM(e, t, r) {
  var n, o;
  function s() {
    var i = t.apply(this, arguments);
    return i !== o && (n = (o = i) && QE(e, i, r)), n;
  }
  return s._value = t, s;
}
function tM(e, t, r) {
  var n = "style." + (e += "");
  if (arguments.length < 2) return (n = this.tween(n)) && n._value;
  if (t == null) return this.tween(n, null);
  if (typeof t != "function") throw new Error();
  return this.tween(n, eM(e, t, r ?? ""));
}
function rM(e) {
  return function() {
    this.textContent = e;
  };
}
function nM(e) {
  return function() {
    var t = e(this);
    this.textContent = t ?? "";
  };
}
function oM(e) {
  return this.tween("text", typeof e == "function" ? nM(Uu(this, "text", e)) : rM(e == null ? "" : e + ""));
}
function sM(e) {
  return function(t) {
    this.textContent = e.call(this, t);
  };
}
function iM(e) {
  var t, r;
  function n() {
    var o = e.apply(this, arguments);
    return o !== r && (t = (r = o) && sM(o)), t;
  }
  return n._value = e, n;
}
function aM(e) {
  var t = "text";
  if (arguments.length < 1) return (t = this.tween(t)) && t._value;
  if (e == null) return this.tween(t, null);
  if (typeof e != "function") throw new Error();
  return this.tween(t, iM(e));
}
function lM() {
  for (var e = this._name, t = this._id, r = am(), n = this._groups, o = n.length, s = 0; s < o; ++s)
    for (var i = n[s], l = i.length, c, u = 0; u < l; ++u)
      if (c = i[u]) {
        var d = Br(c, t);
        La(c, e, r, u, i, {
          time: d.time + d.delay + d.duration,
          delay: 0,
          duration: d.duration,
          ease: d.ease
        });
      }
  return new $n(n, this._parents, e, r);
}
function cM() {
  var e, t, r = this, n = r._id, o = r.size();
  return new Promise(function(s, i) {
    var l = { value: i }, c = { value: function() {
      --o === 0 && s();
    } };
    r.each(function() {
      var u = an(this, n), d = u.on;
      d !== e && (t = (e = d).copy(), t._.cancel.push(l), t._.interrupt.push(l), t._.end.push(c)), u.on = t;
    }), o === 0 && s();
  });
}
var uM = 0;
function $n(e, t, r, n) {
  this._groups = e, this._parents = t, this._name = r, this._id = n;
}
function am() {
  return ++uM;
}
var dn = oi.prototype;
$n.prototype = {
  constructor: $n,
  select: BE,
  selectAll: WE,
  selectChild: dn.selectChild,
  selectChildren: dn.selectChildren,
  filter: DE,
  merge: LE,
  selection: qE,
  transition: lM,
  call: dn.call,
  nodes: dn.nodes,
  node: dn.node,
  size: dn.size,
  empty: dn.empty,
  each: dn.each,
  on: FE,
  attr: _E,
  attrTween: zE,
  style: JE,
  styleTween: tM,
  text: oM,
  textTween: aM,
  remove: UE,
  tween: pE,
  delay: ME,
  duration: OE,
  ease: PE,
  easeVarying: RE,
  end: cM,
  [Symbol.iterator]: dn[Symbol.iterator]
};
function dM(e) {
  return ((e *= 2) <= 1 ? e * e * e : (e -= 2) * e * e + 2) / 2;
}
var fM = {
  time: null,
  // Set on use.
  delay: 0,
  duration: 250,
  ease: dM
};
function hM(e, t) {
  for (var r; !(r = e.__transition) || !(r = r[t]); )
    if (!(e = e.parentNode))
      throw new Error(`transition ${t} not found`);
  return r;
}
function pM(e) {
  var t, r;
  e instanceof $n ? (t = e._id, e = e._name) : (t = am(), (r = fM).time = Du(), e = e == null ? null : e + "");
  for (var n = this._groups, o = n.length, s = 0; s < o; ++s)
    for (var i = n[s], l = i.length, c, u = 0; u < l; ++u)
      (c = i[u]) && La(c, e, t, u, i, r || hM(c, t));
  return new $n(n, this._parents, e, t);
}
oi.prototype.interrupt = jA;
oi.prototype.transition = pM;
const Mi = (e) => () => e;
function vM(e, {
  sourceEvent: t,
  target: r,
  transform: n,
  dispatch: o
}) {
  Object.defineProperties(this, {
    type: { value: e, enumerable: !0, configurable: !0 },
    sourceEvent: { value: t, enumerable: !0, configurable: !0 },
    target: { value: r, enumerable: !0, configurable: !0 },
    transform: { value: n, enumerable: !0, configurable: !0 },
    _: { value: o }
  });
}
function gn(e, t, r) {
  this.k = e, this.x = t, this.y = r;
}
gn.prototype = {
  constructor: gn,
  scale: function(e) {
    return e === 1 ? this : new gn(this.k * e, this.x, this.y);
  },
  translate: function(e, t) {
    return e === 0 & t === 0 ? this : new gn(this.k, this.x + this.k * e, this.y + this.k * t);
  },
  apply: function(e) {
    return [e[0] * this.k + this.x, e[1] * this.k + this.y];
  },
  applyX: function(e) {
    return e * this.k + this.x;
  },
  applyY: function(e) {
    return e * this.k + this.y;
  },
  invert: function(e) {
    return [(e[0] - this.x) / this.k, (e[1] - this.y) / this.k];
  },
  invertX: function(e) {
    return (e - this.x) / this.k;
  },
  invertY: function(e) {
    return (e - this.y) / this.k;
  },
  rescaleX: function(e) {
    return e.copy().domain(e.range().map(this.invertX, this).map(e.invert, e));
  },
  rescaleY: function(e) {
    return e.copy().domain(e.range().map(this.invertY, this).map(e.invert, e));
  },
  toString: function() {
    return "translate(" + this.x + "," + this.y + ") scale(" + this.k + ")";
  }
};
var ma = new gn(1, 0, 0);
gn.prototype;
function hl(e) {
  e.stopImmediatePropagation();
}
function ps(e) {
  e.preventDefault(), e.stopImmediatePropagation();
}
function gM(e) {
  return (!e.ctrlKey || e.type === "wheel") && !e.button;
}
function mM() {
  var e = this;
  return e instanceof SVGElement ? (e = e.ownerSVGElement || e, e.hasAttribute("viewBox") ? (e = e.viewBox.baseVal, [[e.x, e.y], [e.x + e.width, e.y + e.height]]) : [[0, 0], [e.width.baseVal.value, e.height.baseVal.value]]) : [[0, 0], [e.clientWidth, e.clientHeight]];
}
function Uf() {
  return this.__zoom || ma;
}
function bM(e) {
  return -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 2e-3) * (e.ctrlKey ? 10 : 1);
}
function xM() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function yM(e, t, r) {
  var n = e.invertX(t[0][0]) - r[0][0], o = e.invertX(t[1][0]) - r[1][0], s = e.invertY(t[0][1]) - r[0][1], i = e.invertY(t[1][1]) - r[1][1];
  return e.translate(
    o > n ? (n + o) / 2 : Math.min(0, n) || Math.max(0, o),
    i > s ? (s + i) / 2 : Math.min(0, s) || Math.max(0, i)
  );
}
function _M() {
  var e = gM, t = mM, r = yM, n = bM, o = xM, s = [0, 1 / 0], i = [[-1 / 0, -1 / 0], [1 / 0, 1 / 0]], l = 250, c = dE, u = ni("start", "zoom", "end"), d, f, h, p = 500, v = 150, g = 0, y = 10;
  function _(P) {
    P.property("__zoom", Uf).on("wheel.zoom", w, { passive: !1 }).on("mousedown.zoom", O).on("dblclick.zoom", A).filter(o).on("touchstart.zoom", R).on("touchmove.zoom", W).on("touchend.zoom touchcancel.zoom", q).style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  _.transform = function(P, H, V, Y) {
    var oe = P.selection ? P.selection() : P;
    oe.property("__zoom", Uf), P !== oe ? $(P, H, V, Y) : oe.interrupt().each(function() {
      E(this, arguments).event(Y).start().zoom(null, typeof H == "function" ? H.apply(this, arguments) : H).end();
    });
  }, _.scaleBy = function(P, H, V, Y) {
    _.scaleTo(P, function() {
      var oe = this.__zoom.k, X = typeof H == "function" ? H.apply(this, arguments) : H;
      return oe * X;
    }, V, Y);
  }, _.scaleTo = function(P, H, V, Y) {
    _.transform(P, function() {
      var oe = t.apply(this, arguments), X = this.__zoom, I = V == null ? b(oe) : typeof V == "function" ? V.apply(this, arguments) : V, te = X.invert(I), F = typeof H == "function" ? H.apply(this, arguments) : H;
      return r(S(k(X, F), I, te), oe, i);
    }, V, Y);
  }, _.translateBy = function(P, H, V, Y) {
    _.transform(P, function() {
      return r(this.__zoom.translate(
        typeof H == "function" ? H.apply(this, arguments) : H,
        typeof V == "function" ? V.apply(this, arguments) : V
      ), t.apply(this, arguments), i);
    }, null, Y);
  }, _.translateTo = function(P, H, V, Y, oe) {
    _.transform(P, function() {
      var X = t.apply(this, arguments), I = this.__zoom, te = Y == null ? b(X) : typeof Y == "function" ? Y.apply(this, arguments) : Y;
      return r(ma.translate(te[0], te[1]).scale(I.k).translate(
        typeof H == "function" ? -H.apply(this, arguments) : -H,
        typeof V == "function" ? -V.apply(this, arguments) : -V
      ), X, i);
    }, Y, oe);
  };
  function k(P, H) {
    return H = Math.max(s[0], Math.min(s[1], H)), H === P.k ? P : new gn(H, P.x, P.y);
  }
  function S(P, H, V) {
    var Y = H[0] - V[0] * P.k, oe = H[1] - V[1] * P.k;
    return Y === P.x && oe === P.y ? P : new gn(P.k, Y, oe);
  }
  function b(P) {
    return [(+P[0][0] + +P[1][0]) / 2, (+P[0][1] + +P[1][1]) / 2];
  }
  function $(P, H, V, Y) {
    P.on("start.zoom", function() {
      E(this, arguments).event(Y).start();
    }).on("interrupt.zoom end.zoom", function() {
      E(this, arguments).event(Y).end();
    }).tween("zoom", function() {
      var oe = this, X = arguments, I = E(oe, X).event(Y), te = t.apply(oe, X), F = V == null ? b(te) : typeof V == "function" ? V.apply(oe, X) : V, Q = Math.max(te[1][0] - te[0][0], te[1][1] - te[0][1]), pe = oe.__zoom, fe = typeof H == "function" ? H.apply(oe, X) : H, G = c(pe.invert(F).concat(Q / pe.k), fe.invert(F).concat(Q / fe.k));
      return function(ve) {
        if (ve === 1) ve = fe;
        else {
          var ke = G(ve), se = Q / ke[2];
          ve = new gn(se, F[0] - ke[0] * se, F[1] - ke[1] * se);
        }
        I.zoom(null, ve);
      };
    });
  }
  function E(P, H, V) {
    return !V && P.__zooming || new C(P, H);
  }
  function C(P, H) {
    this.that = P, this.args = H, this.active = 0, this.sourceEvent = null, this.extent = t.apply(P, H), this.taps = 0;
  }
  C.prototype = {
    event: function(P) {
      return P && (this.sourceEvent = P), this;
    },
    start: function() {
      return ++this.active === 1 && (this.that.__zooming = this, this.emit("start")), this;
    },
    zoom: function(P, H) {
      return this.mouse && P !== "mouse" && (this.mouse[1] = H.invert(this.mouse[0])), this.touch0 && P !== "touch" && (this.touch0[1] = H.invert(this.touch0[0])), this.touch1 && P !== "touch" && (this.touch1[1] = H.invert(this.touch1[0])), this.that.__zoom = H, this.emit("zoom"), this;
    },
    end: function() {
      return --this.active === 0 && (delete this.that.__zooming, this.emit("end")), this;
    },
    emit: function(P) {
      var H = dr(this.that).datum();
      u.call(
        P,
        this.that,
        new vM(P, {
          sourceEvent: this.sourceEvent,
          target: _,
          transform: this.that.__zoom,
          dispatch: u
        }),
        H
      );
    }
  };
  function w(P, ...H) {
    if (!e.apply(this, arguments)) return;
    var V = E(this, H).event(P), Y = this.__zoom, oe = Math.max(s[0], Math.min(s[1], Y.k * Math.pow(2, n.apply(this, arguments)))), X = hn(P);
    if (V.wheel)
      (V.mouse[0][0] !== X[0] || V.mouse[0][1] !== X[1]) && (V.mouse[1] = Y.invert(V.mouse[0] = X)), clearTimeout(V.wheel);
    else {
      if (Y.k === oe) return;
      V.mouse = [X, Y.invert(X)], Zi(this), V.start();
    }
    ps(P), V.wheel = setTimeout(I, v), V.zoom("mouse", r(S(k(Y, oe), V.mouse[0], V.mouse[1]), V.extent, i));
    function I() {
      V.wheel = null, V.end();
    }
  }
  function O(P, ...H) {
    if (h || !e.apply(this, arguments)) return;
    var V = P.currentTarget, Y = E(this, H, !0).event(P), oe = dr(P.view).on("mousemove.zoom", F, !0).on("mouseup.zoom", Q, !0), X = hn(P, V), I = P.clientX, te = P.clientY;
    Yg(P.view), hl(P), Y.mouse = [X, this.__zoom.invert(X)], Zi(this), Y.start();
    function F(pe) {
      if (ps(pe), !Y.moved) {
        var fe = pe.clientX - I, G = pe.clientY - te;
        Y.moved = fe * fe + G * G > g;
      }
      Y.event(pe).zoom("mouse", r(S(Y.that.__zoom, Y.mouse[0] = hn(pe, V), Y.mouse[1]), Y.extent, i));
    }
    function Q(pe) {
      oe.on("mousemove.zoom mouseup.zoom", null), Xg(pe.view, Y.moved), ps(pe), Y.event(pe).end();
    }
  }
  function A(P, ...H) {
    if (e.apply(this, arguments)) {
      var V = this.__zoom, Y = hn(P.changedTouches ? P.changedTouches[0] : P, this), oe = V.invert(Y), X = V.k * (P.shiftKey ? 0.5 : 2), I = r(S(k(V, X), Y, oe), t.apply(this, H), i);
      ps(P), l > 0 ? dr(this).transition().duration(l).call($, I, Y, P) : dr(this).call(_.transform, I, Y, P);
    }
  }
  function R(P, ...H) {
    if (e.apply(this, arguments)) {
      var V = P.touches, Y = V.length, oe = E(this, H, P.changedTouches.length === Y).event(P), X, I, te, F;
      for (hl(P), I = 0; I < Y; ++I)
        te = V[I], F = hn(te, this), F = [F, this.__zoom.invert(F), te.identifier], oe.touch0 ? !oe.touch1 && oe.touch0[2] !== F[2] && (oe.touch1 = F, oe.taps = 0) : (oe.touch0 = F, X = !0, oe.taps = 1 + !!d);
      d && (d = clearTimeout(d)), X && (oe.taps < 2 && (f = F[0], d = setTimeout(function() {
        d = null;
      }, p)), Zi(this), oe.start());
    }
  }
  function W(P, ...H) {
    if (this.__zooming) {
      var V = E(this, H).event(P), Y = P.changedTouches, oe = Y.length, X, I, te, F;
      for (ps(P), X = 0; X < oe; ++X)
        I = Y[X], te = hn(I, this), V.touch0 && V.touch0[2] === I.identifier ? V.touch0[0] = te : V.touch1 && V.touch1[2] === I.identifier && (V.touch1[0] = te);
      if (I = V.that.__zoom, V.touch1) {
        var Q = V.touch0[0], pe = V.touch0[1], fe = V.touch1[0], G = V.touch1[1], ve = (ve = fe[0] - Q[0]) * ve + (ve = fe[1] - Q[1]) * ve, ke = (ke = G[0] - pe[0]) * ke + (ke = G[1] - pe[1]) * ke;
        I = k(I, Math.sqrt(ve / ke)), te = [(Q[0] + fe[0]) / 2, (Q[1] + fe[1]) / 2], F = [(pe[0] + G[0]) / 2, (pe[1] + G[1]) / 2];
      } else if (V.touch0) te = V.touch0[0], F = V.touch0[1];
      else return;
      V.zoom("touch", r(S(I, te, F), V.extent, i));
    }
  }
  function q(P, ...H) {
    if (this.__zooming) {
      var V = E(this, H).event(P), Y = P.changedTouches, oe = Y.length, X, I;
      for (hl(P), h && clearTimeout(h), h = setTimeout(function() {
        h = null;
      }, p), X = 0; X < oe; ++X)
        I = Y[X], V.touch0 && V.touch0[2] === I.identifier ? delete V.touch0 : V.touch1 && V.touch1[2] === I.identifier && delete V.touch1;
      if (V.touch1 && !V.touch0 && (V.touch0 = V.touch1, delete V.touch1), V.touch0) V.touch0[1] = this.__zoom.invert(V.touch0[0]);
      else if (V.end(), V.taps === 2 && (I = hn(I, this), Math.hypot(f[0] - I[0], f[1] - I[1]) < y)) {
        var te = dr(this).on("dblclick.zoom");
        te && te.apply(this, arguments);
      }
    }
  }
  return _.wheelDelta = function(P) {
    return arguments.length ? (n = typeof P == "function" ? P : Mi(+P), _) : n;
  }, _.filter = function(P) {
    return arguments.length ? (e = typeof P == "function" ? P : Mi(!!P), _) : e;
  }, _.touchable = function(P) {
    return arguments.length ? (o = typeof P == "function" ? P : Mi(!!P), _) : o;
  }, _.extent = function(P) {
    return arguments.length ? (t = typeof P == "function" ? P : Mi([[+P[0][0], +P[0][1]], [+P[1][0], +P[1][1]]]), _) : t;
  }, _.scaleExtent = function(P) {
    return arguments.length ? (s[0] = +P[0], s[1] = +P[1], _) : [s[0], s[1]];
  }, _.translateExtent = function(P) {
    return arguments.length ? (i[0][0] = +P[0][0], i[1][0] = +P[1][0], i[0][1] = +P[0][1], i[1][1] = +P[1][1], _) : [[i[0][0], i[0][1]], [i[1][0], i[1][1]]];
  }, _.constrain = function(P) {
    return arguments.length ? (r = P, _) : r;
  }, _.duration = function(P) {
    return arguments.length ? (l = +P, _) : l;
  }, _.interpolate = function(P) {
    return arguments.length ? (c = P, _) : c;
  }, _.on = function() {
    var P = u.on.apply(u, arguments);
    return P === u ? _ : P;
  }, _.clickDistance = function(P) {
    return arguments.length ? (g = (P = +P) * P, _) : Math.sqrt(g);
  }, _.tapDistance = function(P) {
    return arguments.length ? (y = +P, _) : y;
  }, _;
}
var wM = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function kM(e, t) {
  let r = /* @__PURE__ */ K(t, wM);
  const n = {
    name: "plus",
    size: 24,
    node: [["path", { d: "M5 12h14" }], ["path", { d: "M12 5v14" }]]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var SM = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function $M(e, t) {
  let r = /* @__PURE__ */ K(t, SM);
  const n = {
    name: "maximize",
    size: 24,
    node: [
      ["path", { d: "M8 3H5a2 2 0 0 0-2 2v3" }],
      ["path", { d: "M21 8V5a2 2 0 0 0-2-2h-3" }],
      ["path", { d: "M3 16v3a2 2 0 0 0 2 2h3" }],
      ["path", { d: "M16 21h3a2 2 0 0 0 2-2v-3" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var zM = /* @__PURE__ */ Yn('<text text-anchor="middle" class="pointer-events-none"> </text>'), AM = /* @__PURE__ */ Yn('<line vector-effect="non-scaling-stroke"></line><!>', 1), EM = /* @__PURE__ */ Yn('<circle fill="none" stroke-width="2.5" vector-effect="non-scaling-stroke" style="stroke: var(--gilt)"></circle>'), MM = /* @__PURE__ */ Yn('<circle stroke-width="1.5" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" style="fill: var(--graph-surface); stroke: var(--graph-other)"></circle>'), TM = /* @__PURE__ */ Yn('<circle stroke-width="2" vector-effect="non-scaling-stroke"></circle><!>', 1), CM = /* @__PURE__ */ Yn('<text text-anchor="middle"> </text>'), OM = /* @__PURE__ */ Yn('<g class="cursor-pointer" role="button" tabindex="-1"><!><!><circle fill="transparent"></circle><!></g>'), NM = /* @__PURE__ */ z('<div class="bg-popover text-popover-foreground pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 -translate-y-full rounded-md border px-2.5 py-1.5 text-xs shadow-md"><div class="font-medium"> </div> <div class="text-muted-foreground font-mono text-[11px]"> </div> <div class="text-muted-foreground mt-0.5"> </div></div>'), PM = /* @__PURE__ */ z('<div class="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center"><div class="flex max-w-xs flex-col gap-1"><p class="font-serif text-lg">No exhibits on the board</p> <p class="text-muted-foreground text-sm"> </p></div></div>'), IM = /* @__PURE__ */ z('<div class="relative h-full w-full overflow-hidden"><svg class="bg-graph-surface block cursor-grab select-none active:cursor-grabbing" role="img" aria-label="Evidence board: exhibits and the relationships between them"><defs><pattern id="ruled" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M0 27.5H28" style="stroke: var(--graph-rule)"></path></pattern><marker id="arrow" viewBox="0 -4 8 8" refX="8" refY="0" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,-4L8,0L0,4" style="fill: var(--graph-edge)"></path></marker><marker id="arrow-strong" viewBox="0 -4 8 8" refX="8" refY="0" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,-4L8,0L0,4" style="fill: var(--graph-label)"></path></marker></defs><rect fill="url(#ruled)"></rect><g><!><!></g></svg> <!> <div class="absolute right-3 bottom-3 flex flex-col gap-1"><!> <!> <!></div> <!></div>');
function lm(e, t) {
  Ee(t, !0);
  let r = be(t, "emptyHint", 3, "Switch exhibit types on in the index, or find one with search."), n = /* @__PURE__ */ he(void 0), o = /* @__PURE__ */ he(0), s = /* @__PURE__ */ he(0), i = /* @__PURE__ */ he(Gt(ma)), l = /* @__PURE__ */ he(0), c = /* @__PURE__ */ he([]), u = /* @__PURE__ */ he([]), d = /* @__PURE__ */ he(null), f;
  const h = qz().force("charge", Gz().strength(-320).distanceMax(600)).force("collide", Tz((U) => y(U) + 14)).force("x", Kz(0).strength(0.04)).force("y", Yz(0).strength(0.04)).on("tick", () => Z(l, a(l) + 1)).stop(), p = /* @__PURE__ */ new Map(), v = /* @__PURE__ */ new Map();
  let g = !1;
  const y = (U) => U.ghost ? 6 : 11 + Math.min(9, Math.sqrt(U.degree) * 2);
  _t(() => {
    const [U, ee] = [t.nodes, t.links];
    Vt(() => _(U, ee));
  });
  function _(U, ee) {
    const ue = /* @__PURE__ */ new Map();
    for (const _e of ee)
      ue.set(_e.source, (ue.get(_e.source) ?? 0) + 1), ue.set(_e.target, (ue.get(_e.target) ?? 0) + 1);
    const me = [], Re = U.map((_e) => {
      let Le = p.get(_e.id);
      return Le || (Le = { ..._e, degree: 0 }, p.set(_e.id, Le), me.push(Le)), Object.assign(Le, _e, { degree: ue.get(_e.id) ?? 0 }), Le;
    }), Ve = ee.flatMap((_e) => {
      const Le = p.get(_e.source), De = p.get(_e.target);
      if (!Le || !De) return [];
      let ce = v.get(_e.key);
      return ce || (ce = { key: _e.key, rel: _e.rel, source: Le, target: De }, v.set(_e.key, ce)), ce.source = Le, ce.target = De, [ce];
    });
    for (const _e of me) {
      const Le = Ve.find((De) => De.source === _e && De.target.x !== void 0)?.target ?? Ve.find((De) => De.target === _e && De.source.x !== void 0)?.source;
      Le?.x !== void 0 && Le.y !== void 0 && (_e.x = Le.x + (Math.random() - 0.5) * 40, _e.y = Le.y + (Math.random() - 0.5) * 40);
    }
    if (h.nodes(Re), h.force("link", Oz(Ve).id((_e) => _e.id).distance((_e) => 70 + y(_e.source) + y(_e.target)).strength(0.5)), Z(c, Re), Z(u, Ve), !g && Re.length > 0) {
      h.alpha(1);
      for (let _e = 0; _e < 300 && h.alpha() > h.alphaMin(); _e += 1) h.tick();
      g = !0, Z(l, a(l) + 1);
    } else
      h.alpha(me.length > 0 ? 0.5 : 0.15).restart();
  }
  let k = /* @__PURE__ */ he(!1);
  os(() => (f = _M().scaleExtent([0.08, 6]).on("zoom", (U) => Z(i, U.transform, !0)), a(n) && dr(a(n)).call(f).on("dblclick.zoom", null), Z(k, !0), () => h.stop()));
  let S = !1;
  _t(() => {
    S || !a(k) || a(o) === 0 || a(s) === 0 || a(c).length === 0 || (S = !0, b(a(c), !1));
  });
  function b(U, ee = !0) {
    if (!a(n) || !f || a(o) === 0 || U.length === 0) return;
    const ue = U.map((ze) => ze.x ?? 0), me = U.map((ze) => ze.y ?? 0), [Re, Ve, _e, Le] = [
      Math.min(...ue),
      Math.max(...ue),
      Math.min(...me),
      Math.max(...me)
    ], De = 80, ce = Math.min(U.length === 1 ? 1.6 : 1.4, (a(o) - De * 2) / Math.max(1, Ve - Re), (a(s) - De * 2) / Math.max(1, Le - _e)), xe = ma.translate(a(o) / 2 - ce * (Re + Ve) / 2, a(s) / 2 - ce * (_e + Le) / 2).scale(Math.max(0.08, ce)), Se = dr(a(n));
    ee ? Se.transition().duration(450).call(f.transform, xe) : Se.call(f.transform, xe);
  }
  const $ = (U) => {
    a(n) && f && dr(a(n)).transition().duration(200).call(f.scaleBy, U);
  };
  let E = -1;
  _t(() => {
    if (!t.focus || t.focus.nonce === E) return;
    E = t.focus.nonce;
    const U = new Set(t.focus.ids), ee = a(c).filter((ue) => U.has(ue.id));
    setTimeout(() => b(ee), ee.some((ue) => ue.x === void 0) ? 300 : 0);
  });
  function C(U, ee) {
    let ue = ee;
    return dr(U).call(IA().on("start", (me) => {
      me.active || h.alphaTarget(0.2).restart(), ue.fx = ue.x, ue.fy = ue.y;
    }).on("drag", (me) => {
      ue.fx = me.x, ue.fy = me.y;
    }).on("end", (me) => {
      me.active || h.alphaTarget(0), ue.fx = null, ue.fy = null;
    })), {
      update(me) {
        ue = me;
      }
    };
  }
  const w = (U, ee) => {
    const { source: ue, target: me } = U, Re = (me.x ?? 0) - (ue.x ?? 0), Ve = (me.y ?? 0) - (ue.y ?? 0), _e = Math.hypot(Re, Ve) || 1, Le = y(ue) + 1, De = y(me) + 3;
    return {
      x1: (ue.x ?? 0) + Re * Le / _e,
      y1: (ue.y ?? 0) + Ve * Le / _e,
      x2: (me.x ?? 0) - Re * De / _e,
      y2: (me.y ?? 0) - Ve * De / _e,
      mx: (ue.x ?? 0) + Re / 2,
      my: (ue.y ?? 0) + Ve / 2,
      angle: (Math.atan2(Ve, Re) * 180 / Math.PI + 450) % 180 - 90
    };
  }, O = (U, ee) => `translate(${U.x ?? 0},${U.y ?? 0})`, A = /* @__PURE__ */ T(() => new Set([...a(c)].sort((U, ee) => ee.degree - U.degree).slice(0, 12).filter((U) => U.degree > 1).map((U) => U.id))), R = (U) => t.emphasis !== null && !t.emphasis.nodes.has(U), W = (U) => t.emphasis !== null && !t.emphasis.links.has(U.key), q = (U) => a(i).k >= 1.2 || U.id === t.selected || a(d)?.id === U.id || (t.emphasis !== null ? t.emphasis.nodes.has(U.id) && (t.emphasis.nodes.size <= 30 || a(i).k >= 0.7) : a(A).has(U.id)), P = (U) => a(d) !== null ? U.source === a(d) || U.target === a(d) : t.emphasis !== null && t.emphasis.links.has(U.key) && t.emphasis.links.size <= 40, H = (U) => U.length > 28 ? `${U.slice(0, 27)}…` : U, V = /* @__PURE__ */ T(() => (a(l), a(d) ? {
    node: a(d),
    left: a(i).applyX(a(d).x ?? 0),
    top: a(i).applyY(a(d).y ?? 0) - y(a(d)) * a(i).k
  } : null));
  var Y = IM(), oe = M(Y), X = m(M(oe)), I = m(X), te = M(I);
  Ae(te, 17, () => a(u), (U) => U.key, (U, ee) => {
    const ue = /* @__PURE__ */ T(() => w(a(ee), a(l))), me = /* @__PURE__ */ T(() => t.emphasis !== null && !W(a(ee)));
    var Re = AM(), Ve = re(Re), _e = m(Ve);
    {
      var Le = (ce) => {
        var xe = zM(), Se = j(xe, !0);
        L(() => {
          $e(xe, "x", a(ue).mx), $e(xe, "y", a(ue).my), $e(xe, "dy", -3 / a(i).k), $e(xe, "transform", `rotate(${a(ue).angle ?? ""} ${a(ue).mx ?? ""} ${a(ue).my ?? ""})`), Ln(xe, `font-size: ${10 / a(i).k}px; fill: var(--graph-label); paint-order: stroke; stroke: var(--graph-surface); stroke-width: ${3 / a(i).k}px`), N(Se, a(ee).rel);
        }), x(ce, xe);
      }, De = /* @__PURE__ */ T(() => P(a(ee)));
      D(_e, (ce) => {
        a(De) && ce(Le);
      });
    }
    L(
      (ce) => {
        $e(Ve, "x1", a(ue).x1), $e(Ve, "y1", a(ue).y1), $e(Ve, "x2", a(ue).x2), $e(Ve, "y2", a(ue).y2), $e(Ve, "stroke-width", a(me) ? 1.75 : 1), $e(Ve, "stroke-dasharray", a(ee).target.ghost ? "4 3" : void 0), $e(Ve, "marker-end", a(me) ? "url(#arrow-strong)" : "url(#arrow)"), Ln(Ve, `stroke: ${a(me) ? "var(--graph-label)" : "var(--graph-edge)"}`), $e(Ve, "opacity", ce);
      },
      [() => W(a(ee)) ? 0.12 : 1]
    ), x(U, Re);
  });
  var F = m(te);
  Ae(F, 17, () => a(c), (U) => U.id, (U, ee) => {
    const ue = /* @__PURE__ */ T(() => y(a(ee)));
    var me = OM(), Re = M(me);
    {
      var Ve = (de) => {
        var we = EM();
        L(() => $e(we, "r", a(ue) + 4 / a(i).k)), x(de, we);
      };
      D(Re, (de) => {
        a(ee).id === t.selected && de(Ve);
      });
    }
    var _e = m(Re);
    {
      var Le = (de) => {
        var we = MM();
        L(() => $e(we, "r", a(ue))), x(de, we);
      }, De = (de) => {
        const we = /* @__PURE__ */ T(() => t.iconOf(a(ee).type)), je = /* @__PURE__ */ T(() => a(ue) * 1.15);
        var Fe = TM(), Xe = re(Fe), ie = m(Xe);
        {
          let B = /* @__PURE__ */ T(() => -a(je) / 2), ne = /* @__PURE__ */ T(() => -a(je) / 2);
          It(ie, () => a(we), (ge, Te) => {
            Te(ge, {
              get x() {
                return a(B);
              },
              get y() {
                return a(ne);
              },
              get size() {
                return a(je);
              },
              color: "#fff",
              strokeWidth: 2.25,
              class: "pointer-events-none",
              "aria-hidden": "true"
            });
          });
        }
        L(
          (B) => {
            $e(Xe, "r", a(ue)), Ln(Xe, `fill: ${B ?? ""}; stroke: var(--graph-surface)`);
          },
          [() => t.colourOf(a(ee).type)]
        ), x(de, Fe);
      };
      D(_e, (de) => {
        a(ee).ghost ? de(Le) : de(De, -1);
      });
    }
    var ce = m(_e), xe = m(ce);
    {
      var Se = (de) => {
        var we = CM(), je = j(we, !0);
        L(
          (Fe) => {
            $e(we, "y", a(ue) + 13 / a(i).k), Ye(we, 0, `pointer-events-none ${a(ee).id === t.selected ? "font-semibold" : ""}`), Ln(we, `font-size: ${11 / a(i).k}px; fill: ${a(ee).ghost ? "var(--graph-other)" : "var(--foreground)"}; paint-order: stroke; stroke: var(--graph-surface); stroke-width: ${3 / a(i).k}px; stroke-linejoin: round`), N(je, Fe);
          },
          [
            () => H(a(ee).ghost ? a(ee).id : a(ee).title)
          ]
        ), x(de, we);
      }, ze = /* @__PURE__ */ T(() => q(a(ee)));
      D(xe, (de) => {
        a(ze) && de(Se);
      });
    }
    Lb(me, (de, we) => C?.(de, we), () => a(ee)), L(
      (de, we) => {
        $e(me, "transform", de), $e(me, "opacity", we), $e(me, "aria-label", a(ee).title), $e(ce, "r", a(ue) + 6);
      },
      [
        () => O(a(ee), a(l)),
        () => R(a(ee).id) ? 0.15 : 1
      ]
    ), ht("click", me, (de) => {
      de.stopPropagation(), t.onselect(a(ee).id);
    }), jn("pointerenter", me, () => Z(d, a(ee), !0)), jn("pointerleave", me, () => Z(d, null)), x(U, me);
  }), _n(oe, (U) => Z(n, U), () => a(n));
  var Q = m(oe, 2);
  {
    var pe = (U) => {
      var ee = NM(), ue = M(ee), me = j(ue, !0), Re = m(ue, 2), Ve = j(Re, !0), _e = m(Re, 2), Le = j(_e);
      L(() => {
        Ln(ee, `left: ${a(V).left ?? ""}px; top: ${a(V).top - 8}px`), N(me, a(V).node.ghost ? a(V).node.id : a(V).node.title), N(Ve, a(V).node.ghost ? "no file in the casebook defines it yet" : a(V).node.id), N(Le, `${(a(V).node.ghost ? "unresolved reference" : a(V).node.type) ?? ""} · ${a(V).node.degree ?? ""}
        ${a(V).node.degree === 1 ? "link" : "links"}`);
      }), x(U, ee);
    };
    D(Q, (U) => {
      a(V) && U(pe);
    });
  }
  var fe = m(Q, 2), G = M(fe);
  ft(G, {
    variant: "outline",
    size: "icon-sm",
    "aria-label": "Zoom in",
    onclick: () => $(1.4),
    children: (U, ee) => {
      kM(U, {});
    },
    $$slots: { default: !0 }
  });
  var ve = m(G, 2);
  ft(ve, {
    variant: "outline",
    size: "icon-sm",
    "aria-label": "Zoom out",
    onclick: () => $(1 / 1.4),
    children: (U, ee) => {
      bg(U, {});
    },
    $$slots: { default: !0 }
  });
  var ke = m(ve, 2);
  ft(ke, {
    variant: "outline",
    size: "icon-sm",
    "aria-label": "Fit the graph to the view",
    onclick: () => b(a(c)),
    children: (U, ee) => {
      $M(U, {});
    },
    $$slots: { default: !0 }
  });
  var se = m(fe, 2);
  {
    var ye = (U) => {
      var ee = PM(), ue = M(ee), me = m(M(ue), 2), Re = j(me, !0);
      L(() => N(Re, r())), x(U, ee);
    };
    D(se, (U) => {
      t.nodes.length === 0 && U(ye);
    });
  }
  L(
    (U) => {
      $e(oe, "width", a(o)), $e(oe, "height", a(s)), $e(X, "width", a(o)), $e(X, "height", a(s)), $e(I, "transform", U);
    },
    [() => a(i).toString()]
  ), ht("click", X, () => t.onselect(null)), id(Y, "clientWidth", (U) => Z(o, U)), id(Y, "clientHeight", (U) => Z(s, U)), x(e, Y), Me();
}
Lt(["click"]);
var RM = /* @__PURE__ */ z('<!> <span class="bg-muted rounded px-1.5 py-0.5"> </span>', 1), DM = /* @__PURE__ */ z('<li class="flex flex-wrap items-center gap-1 text-xs"><span class="text-muted-foreground"></span> <!></li>'), LM = /* @__PURE__ */ z('<ol class="flex flex-col gap-1"></ol>'), jM = /* @__PURE__ */ z('<li class="flex flex-wrap items-center gap-1.5"><span> </span> <span class="text-muted-foreground font-mono"> </span> <!> <span> </span> <!></li>'), VM = /* @__PURE__ */ z("<!> Show on the board", 1), FM = /* @__PURE__ */ z('<div class="h-72 overflow-hidden rounded-md border"><!></div> <!> <details class="text-xs"><summary class="text-muted-foreground cursor-pointer"> </summary> <ul class="mt-1 flex flex-col gap-1"></ul></details> <div class="flex flex-wrap items-center gap-2"><!> <!></div>', 1);
function ZM(e, t) {
  Ee(t, !0);
  const r = zr(), n = Nu(), o = Ia(), s = /* @__PURE__ */ T(() => new Map(r.graph?.entities.map((A) => [A.id, A]) ?? [])), i = /* @__PURE__ */ T(() => new Map(t.block.nodes.flatMap((A) => A.ref && A.ref.kind === "entity" && Cu(A.ref, o.casebook) ? [[A.id, A.ref.id]] : []))), l = (A) => a(i).get(A) ?? `${t.block.id}\0${A}`, c = /* @__PURE__ */ T(() => new Map(t.block.nodes.map((A) => [A.id, A.label]))), u = /* @__PURE__ */ T(() => {
    const A = /* @__PURE__ */ new Set();
    return t.block.nodes.map((R) => {
      const W = a(s).get(a(i).get(R.id) ?? "");
      return W ? {
        id: W.id,
        title: R.label || W.title,
        type: W.type,
        ghost: !1
      } : {
        id: l(R.id),
        title: R.label,
        type: R.type ?? "",
        ghost: !0
      };
    }).filter((R) => !A.has(R.id) && A.add(R.id));
  }), d = /* @__PURE__ */ T(() => {
    const A = /* @__PURE__ */ new Set();
    return t.block.edges.map((R) => {
      const [W, q] = [l(R.source), l(R.target)];
      return {
        key: Po({ source: W, rel: R.rel, target: q }),
        source: W,
        target: q,
        rel: R.rel
      };
    }).filter((R) => !A.has(R.key) && A.add(R.key));
  }), f = /* @__PURE__ */ T(() => {
    if (!t.block.paths || t.block.paths.length === 0) return null;
    const A = /* @__PURE__ */ new Set(), R = /* @__PURE__ */ new Set();
    for (const q of t.block.paths)
      q.forEach((P, H) => {
        A.add(l(P));
        const V = q[H + 1];
        V !== void 0 && R.add(`${P}\0${V}`);
      });
    const W = new Set(t.block.edges.filter((q) => R.has(`${q.source}\0${q.target}`) || R.has(`${q.target}\0${q.source}`)).map((q) => Po({
      source: l(q.source),
      rel: q.rel,
      target: l(q.target)
    })));
    return { nodes: A, links: W };
  }), h = /* @__PURE__ */ T(() => ({
    label: `${t.result.adapter}'s ${t.block.title ?? "subgraph"}`,
    ids: [...a(i).values()],
    links: t.block.edges.flatMap((A) => {
      const [R, W] = [
        a(i).get(A.source),
        a(i).get(A.target)
      ];
      return R && W ? [{ source: R, rel: A.rel, target: W }] : [];
    })
  }));
  var p = FM(), v = re(p), g = M(v);
  lm(g, {
    get nodes() {
      return a(u);
    },
    get links() {
      return a(d);
    },
    get colourOf() {
      return n.colour;
    },
    get iconOf() {
      return n.icon;
    },
    get selected() {
      return r.selected;
    },
    get emphasis() {
      return a(f);
    },
    focus: null,
    emptyHint: "The adapter returned an empty graph.",
    onselect: (A) => {
      A && a(s).has(A) && r.select(A);
    }
  });
  var y = m(v, 2);
  {
    var _ = (A) => {
      var R = LM();
      Ae(R, 21, () => t.block.paths, xt, (W, q, P) => {
        var H = DM(), V = M(H);
        V.textContent = `Path ${P + 1}:`;
        var Y = m(V, 2);
        Ae(Y, 17, () => a(q), xt, (oe, X, I) => {
          var te = RM(), F = re(te);
          {
            var Q = (G) => {
              Gn(G, { class: "text-muted-foreground size-3" });
            };
            D(F, (G) => {
              I > 0 && G(Q);
            });
          }
          var pe = m(F, 2), fe = j(pe, !0);
          L((G) => N(fe, G), [() => a(c).get(a(X)) ?? a(X)]), x(oe, te);
        }), x(W, H);
      }), x(A, R);
    };
    D(y, (A) => {
      t.block.paths && t.block.paths.length > 0 && A(_);
    });
  }
  var k = m(y, 2), S = M(k), b = j(S), $ = m(S, 2);
  Ae($, 21, () => t.block.edges, xt, (A, R) => {
    var W = jM(), q = M(W), P = j(q, !0), H = m(q, 2), V = j(H, !0), Y = m(H, 2);
    Gn(Y, { class: "text-muted-foreground size-3" });
    var oe = m(Y, 2), X = j(oe, !0), I = m(oe, 2);
    {
      let te = /* @__PURE__ */ T(() => a(R).evidenceIds ?? []);
      Sn(I, {
        get ids() {
          return a(te);
        },
        get result() {
          return t.result;
        }
      });
    }
    L(
      (te, F) => {
        N(P, te), N(V, a(R).rel), N(X, F);
      },
      [
        () => a(c).get(a(R).source) ?? a(R).source,
        () => a(c).get(a(R).target) ?? a(R).target
      ]
    ), x(A, W);
  });
  var E = m(k, 2), C = M(E);
  Sn(C, {
    get ids() {
      return t.block.evidenceIds;
    },
    get result() {
      return t.result;
    }
  });
  var w = m(C, 2);
  {
    var O = (A) => {
      ft(A, {
        variant: "ghost",
        size: "xs",
        class: "ml-auto",
        onclick: () => t.onboard(a(h)),
        children: (R, W) => {
          var q = VM(), P = re(q);
          Ys(P, {}), x(R, q);
        },
        $$slots: { default: !0 }
      });
    };
    D(w, (A) => {
      a(h).ids.length > 0 && A(O);
    });
  }
  L(() => N(b, `${t.block.edges.length ?? ""} ${t.block.edges.length === 1 ? "edge" : "edges"} returned`)), x(e, p), Me();
}
var UM = /* @__PURE__ */ z('<span class="text-muted-foreground text-base font-normal"> </span>'), BM = /* @__PURE__ */ z('<span>Every matching record in scope <code class="font-mono"> </code> </span>'), WM = /* @__PURE__ */ z('<span class="text-amber-700 dark:text-amber-400">Counted from a sample of top matches - not an exhaustive count.</span>'), HM = /* @__PURE__ */ z('<span class="text-muted-foreground">Coverage unknown: the adapter does not say whether this counts every record.</span>'), qM = /* @__PURE__ */ z('<div class="bg-card flex flex-wrap items-end gap-x-6 gap-y-2 rounded-md border px-4 py-3"><div class="flex flex-col"><span class="text-muted-foreground text-xs"> </span> <span class="font-serif text-4xl leading-tight font-semibold tabular-nums"> <!></span></div> <div class="flex min-w-0 flex-1 flex-col gap-1 text-xs"><!> <!></div></div>');
function GM(e, t) {
  Ee(t, !0);
  const r = /* @__PURE__ */ T(() => t.result.answer.coverage);
  var n = qM(), o = M(n), s = M(o), i = j(s, !0), l = m(s, 2), c = M(l), u = m(c);
  {
    var d = (_) => {
      var k = UM(), S = j(k, !0);
      L(() => N(S, t.block.unit)), x(_, k);
    };
    D(u, (_) => {
      t.block.unit && _(d);
    });
  }
  var f = m(o, 2), h = M(f);
  {
    var p = (_) => {
      var k = BM(), S = m(M(k)), b = j(S, !0), $ = m(S);
      L(() => {
        N(b, a(r).scope), N($, `${a(r).truncated ? ", but truncated" : ""}.`);
      }), x(_, k);
    }, v = (_) => {
      var k = WM();
      x(_, k);
    }, g = (_) => {
      var k = HM();
      x(_, k);
    };
    D(h, (_) => {
      a(r).mode === "exhaustive" ? _(p) : a(r).mode === "top-k" ? _(v, 1) : _(g, -1);
    });
  }
  var y = m(h, 2);
  Sn(y, {
    get ids() {
      return t.block.evidenceIds;
    },
    get result() {
      return t.result;
    }
  }), L(
    (_) => {
      N(i, t.block.label), N(c, `${_ ?? ""} `);
    },
    [
      () => t.block.value.toLocaleString(void 0, { maximumFractionDigits: 20 })
    ]
  ), x(e, n), Me();
}
var KM = /* @__PURE__ */ z('<th scope="col"> </th>'), YM = /* @__PURE__ */ z('<th scope="col" class="px-3 py-1.5 font-medium">Evidence</th>'), XM = /* @__PURE__ */ z('<button type="button" class="underline-offset-2 hover:underline"> </button>'), JM = /* @__PURE__ */ z('<code class="font-mono text-xs" title="Not resolved against the casebook"> </code>'), QM = /* @__PURE__ */ z("<span> </span>"), e8 = /* @__PURE__ */ z("<td><!></td>"), t8 = /* @__PURE__ */ z('<td class="px-3 py-1.5"><!></td>'), r8 = /* @__PURE__ */ z('<tr class="border-t align-top"><!><!></tr>'), n8 = /* @__PURE__ */ z('<tr><td class="text-muted-foreground px-3 py-2 text-xs">No rows.</td></tr>'), o8 = /* @__PURE__ */ z('<div class="overflow-x-auto rounded-md border"><table class="w-full border-collapse text-sm"><thead class="bg-muted/60 text-muted-foreground text-left text-xs"><tr><!><!></tr></thead><tbody></tbody></table></div> <!>', 1);
function s8(e, t) {
  Ee(t, !0);
  const r = zr(), n = Ia(), o = (S) => r.graph?.entities.find((b) => b.id === S)?.title ?? S, s = /* @__PURE__ */ T(() => t.block.rows.some((S) => (S.evidenceIds?.length ?? 0) > 0)), i = (S) => ["number", "integer", "decimal"].includes(S.type), l = (S) => typeof S == "object" && S !== null, c = (S, b) => {
    if (S === null) return "—";
    if (b.type === "boolean") return S === !0 ? "yes" : "no";
    if (b.type === "integer" && typeof S == "number") return S.toLocaleString();
    if (b.type === "datetime" && typeof S == "string") {
      const $ = new Date(S);
      if (!Number.isNaN($.getTime())) return $.toLocaleString(void 0, { dateStyle: "medium", timeStyle: "short" });
    }
    return String(S);
  };
  var u = o8(), d = re(u), f = M(d), h = M(f), p = M(h), v = M(p);
  Ae(v, 17, () => t.block.columns, (S) => S.key, (S, b) => {
    var $ = KM(), E = j($, !0);
    L(
      (C) => {
        Ye($, 1, `px-3 py-1.5 font-medium ${C ?? ""}`), $e($, "title", a(b).type), N(E, a(b).label);
      },
      [() => i(a(b)) ? "text-right" : ""]
    ), x(S, $);
  });
  var g = m(v);
  {
    var y = (S) => {
      var b = YM();
      x(S, b);
    };
    D(g, (S) => {
      a(s) && S(y);
    });
  }
  var _ = m(h);
  Ae(
    _,
    21,
    () => t.block.rows,
    xt,
    (S, b) => {
      var $ = r8(), E = M($);
      Ae(E, 17, () => t.block.columns, (O) => O.key, (O, A) => {
        const R = /* @__PURE__ */ T(() => a(b).cells[a(A).key] ?? null);
        var W = e8(), q = M(W);
        {
          var P = (Y) => {
            var oe = Ze(), X = re(oe);
            {
              var I = (Q) => {
                var pe = XM(), fe = j(pe, !0);
                L((G) => N(fe, G), [() => o(a(R).id)]), ht("click", pe, () => r.select(a(R).id)), x(Q, pe);
              }, te = /* @__PURE__ */ T(() => Cu(a(R), n.casebook) && a(R).kind === "entity"), F = (Q) => {
                var pe = JM(), fe = j(pe, !0);
                L(() => N(fe, a(R).id)), x(Q, pe);
              };
              D(X, (Q) => {
                a(te) ? Q(I) : Q(F, -1);
              });
            }
            x(Y, oe);
          }, H = /* @__PURE__ */ T(() => a(A).type === "reference" && l(a(R))), V = (Y) => {
            var oe = QM(), X = j(oe, !0);
            L(
              (I) => {
                Ye(oe, 1, Zo(a(R) === null ? "text-muted-foreground" : "")), $e(oe, "title", typeof a(R) == "string" ? a(R) : void 0), N(X, I);
              },
              [() => c(a(R), a(A))]
            ), x(Y, oe);
          };
          D(q, (Y) => {
            a(H) ? Y(P) : Y(V, -1);
          });
        }
        L((Y) => Ye(W, 1, `px-3 py-1.5 ${Y ?? ""} ${a(A).type === "datetime" || a(A).type === "date" ? "whitespace-nowrap tabular-nums" : ""}`), [
          () => i(a(A)) ? "text-right font-mono tabular-nums" : ""
        ]), x(O, W);
      });
      var C = m(E);
      {
        var w = (O) => {
          var A = t8(), R = M(A);
          {
            let W = /* @__PURE__ */ T(() => a(b).evidenceIds ?? []);
            Sn(R, {
              get ids() {
                return a(W);
              },
              get result() {
                return t.result;
              }
            });
          }
          x(O, A);
        };
        D(C, (O) => {
          a(s) && O(w);
        });
      }
      x(S, $);
    },
    (S) => {
      var b = n8(), $ = j(b);
      L(() => $e($, "colspan", t.block.columns.length + (a(s) ? 1 : 0))), x(S, b);
    }
  );
  var k = m(d, 2);
  Sn(k, {
    get ids() {
      return t.block.evidenceIds;
    },
    get result() {
      return t.result;
    }
  }), x(e, u), Me();
}
Lt(["click"]);
var i8 = /* @__PURE__ */ z('<li class="relative flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 text-sm"><span aria-hidden="true"></span> <time class="text-muted-foreground w-44 shrink-0 text-xs tabular-nums"> </time> <span> </span> <span class="min-w-0 flex-1 break-words"> </span> <!></li>'), a8 = /* @__PURE__ */ z('<li class="text-muted-foreground text-xs">No events.</li>'), l8 = /* @__PURE__ */ z('<ol class="flex flex-col border-l pl-4"></ol> <!>', 1);
function c8(e, t) {
  Ee(t, !0);
  const r = {
    event: "happened",
    observed: "observed",
    "valid-from": "valid from",
    "valid-to": "valid until"
  }, n = /* @__PURE__ */ T(() => [...t.block.events].sort((c, u) => c.at < u.at ? -1 : c.at > u.at ? 1 : 0)), o = (c) => {
    const u = new Date(c);
    return Number.isNaN(u.getTime()) ? c : /T\d/.test(c) ? u.toLocaleString(void 0, { dateStyle: "medium", timeStyle: "short" }) : u.toLocaleDateString(void 0, { dateStyle: "medium" });
  };
  var s = l8(), i = re(s);
  Ae(
    i,
    21,
    () => a(n),
    xt,
    (c, u) => {
      var d = i8(), f = M(d), h = m(f, 2), p = j(h, !0), v = m(h, 2), g = j(v, !0), y = m(v, 2), _ = j(y, !0), k = m(y, 2);
      {
        let S = /* @__PURE__ */ T(() => a(u).evidenceIds ?? []);
        Sn(k, {
          get ids() {
            return a(S);
          },
          get result() {
            return t.result;
          }
        });
      }
      L(
        (S) => {
          Ye(f, 1, `absolute top-3 -left-[1.3rem] size-2 rounded-full ${a(u).semantics === "event" ? "bg-gilt" : "border-muted-foreground bg-background border"}`), $e(h, "datetime", a(u).at), $e(h, "title", a(u).at), N(p, S), Ye(v, 1, `rounded border px-1 text-[10px] ${a(u).semantics === "event" ? "border-gilt/60" : "border-dashed"}`), $e(v, "title", `What the time means: ${r[a(u).semantics] ?? ""}`), N(g, r[a(u).semantics]), N(_, a(u).label);
        },
        [() => o(a(u).at)]
      ), x(c, d);
    },
    (c) => {
      var u = a8();
      x(c, u);
    }
  );
  var l = m(i, 2);
  Sn(l, {
    get ids() {
      return t.block.evidenceIds;
    },
    get result() {
      return t.result;
    }
  }), x(e, s), Me();
}
var u8 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function d8(e, t) {
  let r = /* @__PURE__ */ K(t, u8);
  const n = {
    name: "braces",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"
        }
      ],
      [
        "path",
        {
          d: "M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"
        }
      ]
    ],
    aliases: ["curly-braces"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var f8 = /* @__PURE__ */ z('<dt class="text-muted-foreground font-mono"> </dt> <dd class="min-w-0"><pre class="bg-muted max-h-48 overflow-auto rounded px-2 py-1 font-mono text-[11px] whitespace-pre-wrap"> </pre></dd>', 1), h8 = /* @__PURE__ */ z('<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"></dl>'), p8 = /* @__PURE__ */ z('<div class="flex flex-col gap-2 rounded-md border border-dashed p-3 text-sm"><p class="text-muted-foreground flex items-center gap-1.5 text-xs"><!> A <code class="font-mono"> </code> block, which this version of docket has no view for. Its data, as sent:</p> <!> <!></div>');
function v8(e, t) {
  Ee(t, !0);
  const r = /* @__PURE__ */ T(() => Object.entries(t.block.raw).filter(([f]) => !["id", "kind", "title", "evidenceIds"].includes(f)));
  var n = p8(), o = M(n), s = M(o);
  d8(s, { class: "size-3.5", "aria-hidden": "true" });
  var i = m(s, 2), l = j(i, !0), c = m(o, 2);
  {
    var u = (f) => {
      var h = h8();
      Ae(h, 21, () => a(r), ([p, v]) => p, (p, v) => {
        var g = /* @__PURE__ */ T(() => fr(a(v), 2));
        let y = () => a(g)[0], _ = () => a(g)[1];
        var k = f8(), S = re(k), b = j(S, !0), $ = m(S, 2), E = M($), C = j(E, !0);
        L(
          (w) => {
            N(b, y()), N(C, w);
          },
          [() => JSON.stringify(_(), null, 2)]
        ), x(p, k);
      }), x(f, h);
    };
    D(c, (f) => {
      a(r).length > 0 && f(u);
    });
  }
  var d = m(c, 2);
  Sn(d, {
    get ids() {
      return t.block.evidenceIds;
    },
    get result() {
      return t.result;
    }
  }), L(() => N(l, t.block.kind)), x(e, n), Me();
}
var g8 = /* @__PURE__ */ z('<section class="flex flex-col gap-2"><h4 class="flex items-baseline gap-2 text-sm"><span class="font-medium"> </span> <span class="text-muted-foreground text-[10px] tracking-wide uppercase"> </span></h4> <!></section>');
function m8(e, t) {
  Ee(t, !0);
  const r = {
    entities: "Exhibits",
    passages: "Passages",
    facts: "Facts",
    graph: "Graph",
    metric: "Metric",
    table: "Table",
    timeline: "Timeline"
  };
  var n = g8(), o = M(n), s = M(o), i = j(s, !0), l = m(s, 2), c = j(l, !0), u = m(o, 2);
  {
    var d = (_) => {
      v8(_, {
        get block() {
          return t.shown.block;
        },
        get result() {
          return t.result;
        }
      });
    }, f = (_) => {
      M3(_, {
        get block() {
          return t.shown.block;
        },
        get result() {
          return t.result;
        },
        onboard: (k, S) => t.onboard({ label: S, ids: k, links: [] })
      });
    }, h = (_) => {
      W3(_, {
        get block() {
          return t.shown.block;
        },
        get result() {
          return t.result;
        }
      });
    }, p = (_) => {
      ZM(_, {
        get block() {
          return t.shown.block;
        },
        get result() {
          return t.result;
        },
        get onboard() {
          return t.onboard;
        }
      });
    }, v = (_) => {
      GM(_, {
        get block() {
          return t.shown.block;
        },
        get result() {
          return t.result;
        }
      });
    }, g = (_) => {
      s8(_, {
        get block() {
          return t.shown.block;
        },
        get result() {
          return t.result;
        }
      });
    }, y = (_) => {
      c8(_, {
        get block() {
          return t.shown.block;
        },
        get result() {
          return t.result;
        }
      });
    };
    D(u, (_) => {
      t.shown.known ? t.shown.block.kind === "entities" ? _(f, 1) : t.shown.block.kind === "passages" || t.shown.block.kind === "facts" ? _(h, 2) : t.shown.block.kind === "graph" ? _(p, 3) : t.shown.block.kind === "metric" ? _(v, 4) : t.shown.block.kind === "table" ? _(g, 5) : t.shown.block.kind === "timeline" && _(y, 6) : _(d);
    });
  }
  L(() => {
    $e(n, "aria-label", t.shown.block.title ?? r[t.shown.block.kind] ?? t.shown.block.kind), N(i, t.shown.block.title ?? r[t.shown.block.kind] ?? t.shown.block.kind), N(c, r[t.shown.block.kind] ?? t.shown.block.kind);
  }), x(e, n), Me();
}
var b8 = /* @__PURE__ */ z('<span class="text-muted-foreground font-mono text-[10px]"> </span>'), x8 = /* @__PURE__ */ z("<!> <!>", 1), y8 = /* @__PURE__ */ z('<span class="text-muted-foreground ml-auto text-xs tabular-nums"> </span>'), _8 = /* @__PURE__ */ z('<p class="text-sm"> </p>'), w8 = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs"> </p>'), k8 = /* @__PURE__ */ z("<li> </li>"), S8 = /* @__PURE__ */ z('<ul class="text-muted-foreground flex list-disc flex-col gap-0.5 pl-4 text-xs"></ul>'), $8 = /* @__PURE__ */ z('<details><summary class="text-muted-foreground cursor-pointer text-xs">The native query it ran</summary> <pre class="bg-muted mt-1 overflow-x-auto rounded p-2 font-mono text-[11px] whitespace-pre-wrap"> </pre></details>'), z8 = /* @__PURE__ */ z("<!> <!> <!> <!>", 1), A8 = /* @__PURE__ */ z('<span class="text-muted-foreground text-xs">It may answer if asked again.</span>'), E8 = /* @__PURE__ */ z('<li class="break-words"> </li>'), M8 = /* @__PURE__ */ z('<ul class="text-muted-foreground flex flex-col gap-0.5 font-mono text-[11px]"></ul>'), T8 = /* @__PURE__ */ z('<div class="border-destructive/40 flex gap-2 rounded-md border p-3 text-sm"><!> <div class="flex min-w-0 flex-col gap-1"><span class="break-words"> </span> <!> <!></div></div>'), C8 = /* @__PURE__ */ z('<p><!> <span class="break-words"> </span></p>'), O8 = /* @__PURE__ */ z('<p class="text-muted-foreground text-sm">Nothing found.</p>'), N8 = /* @__PURE__ */ z("<!> <!> <!>", 1), P8 = /* @__PURE__ */ z('<article class="bg-background flex scroll-mt-4 flex-col gap-3 rounded-lg border p-4"><header class="flex flex-col gap-1.5"><div class="flex flex-wrap items-center gap-2"><h3 class="font-mono text-sm font-semibold"> </h3> <!> <!></div> <!></header> <!></article>');
function I8(e, t) {
  Ee(t, !0);
  const r = (k, S) => {
    const b = ($) => {
      const E = new Date($);
      return Number.isNaN(E.getTime()) ? $ : E.toLocaleDateString(void 0, { dateStyle: "medium" });
    };
    return `${b(k)} – ${b(S)}`;
  };
  var n = P8(), o = M(n), s = M(o), i = M(s), l = j(i, !0), c = m(i, 2);
  {
    var u = (k) => {
      Jt(k, {
        variant: "destructive",
        class: "text-[10px]",
        children: (S, b) => {
          var $ = ct();
          L(() => N($, t.result.error.code === "invalid-answer" ? "invalid answer" : "no answer")), x(S, $);
        },
        $$slots: { default: !0 }
      });
    }, d = (k) => {
      const S = /* @__PURE__ */ T(() => t.result.answer.coverage);
      var b = x8(), $ = re(b);
      {
        let w = /* @__PURE__ */ T(() => a(S).scope), O = /* @__PURE__ */ T(() => a(S).checkpoint ? `, checkpoint ${a(S).checkpoint}` : "");
        Jt($, {
          variant: "outline",
          class: "text-[10px]",
          get title() {
            return `Scope ${a(w) ?? ""}${a(O) ?? ""}`;
          },
          children: (A, R) => {
            var W = ct();
            L(() => N(W, `${a(S).mode === "exhaustive" ? "exhaustive" : a(S).mode === "top-k" ? "top matches" : "coverage unknown"}${a(S).truncated ? " · truncated" : ""}`)), x(A, W);
          },
          $$slots: { default: !0 }
        });
      }
      var E = m($, 2);
      {
        var C = (w) => {
          var O = b8(), A = j(O);
          L(() => N(A, `at ${a(S).checkpoint ?? ""}`)), x(w, O);
        };
        D(E, (w) => {
          a(S).checkpoint && w(C);
        });
      }
      x(k, b);
    };
    D(c, (k) => {
      t.result.state === "failed" ? k(u) : k(d, -1);
    });
  }
  var f = m(c, 2);
  {
    var h = (k) => {
      var S = y8(), b = j(S);
      L(($) => N(b, `${$ ?? ""}s`), [
        () => (t.result.durationMs / 1e3).toFixed(t.result.durationMs < 1e3 ? 2 : 1)
      ]), x(k, S);
    };
    D(f, (k) => {
      t.result.durationMs !== void 0 && k(h);
    });
  }
  var p = m(s, 2);
  {
    var v = (k) => {
      const S = /* @__PURE__ */ T(() => t.result.answer.interpretation);
      var b = z8(), $ = re(b);
      {
        var E = (q) => {
          var P = _8(), H = j(P, !0);
          L(() => N(H, a(S).description)), x(q, P);
        };
        D($, (q) => {
          a(S).description && q(E);
        });
      }
      var C = m($, 2);
      {
        var w = (q) => {
          var P = w8(), H = j(P);
          L((V) => N(H, `Time range: ${V ?? ""}`), [
            () => r(a(S).timeRange.from, a(S).timeRange.to)
          ]), x(q, P);
        };
        D(C, (q) => {
          a(S).timeRange && q(w);
        });
      }
      var O = m(C, 2);
      {
        var A = (q) => {
          var P = S8();
          Ae(P, 21, () => a(S).assumptions, xt, (H, V) => {
            var Y = k8(), oe = j(Y);
            L(() => N(oe, `Assumed: ${a(V) ?? ""}`)), x(H, Y);
          }), x(q, P);
        };
        D(O, (q) => {
          a(S).assumptions.length > 0 && q(A);
        });
      }
      var R = m(O, 2);
      {
        var W = (q) => {
          var P = $8(), H = m(M(P), 2), V = j(H, !0);
          L(() => N(V, a(S).nativeQuery)), x(q, P);
        };
        D(R, (q) => {
          a(S).nativeQuery && q(W);
        });
      }
      x(k, b);
    };
    D(p, (k) => {
      t.result.state === "answered" && k(v);
    });
  }
  var g = m(o, 2);
  {
    var y = (k) => {
      var S = T8(), b = M(S);
      or(b, { class: "text-destructive mt-0.5 size-4 shrink-0" });
      var $ = m(b, 2), E = M($), C = j(E, !0), w = m(E, 2);
      {
        var O = (W) => {
          var q = A8();
          x(W, q);
        };
        D(w, (W) => {
          t.result.error.retryable && W(O);
        });
      }
      var A = m(w, 2);
      {
        var R = (W) => {
          var q = M8();
          Ae(q, 21, () => t.result.issues, xt, (P, H) => {
            var V = E8(), Y = j(V, !0);
            L(() => N(Y, a(H))), x(P, V);
          }), x(W, q);
        };
        D(A, (W) => {
          t.result.issues && t.result.issues.length > 0 && W(R);
        });
      }
      L(() => N(C, t.result.error.message)), x(k, S);
    }, _ = (k) => {
      var S = N8(), b = re(S);
      Ae(b, 17, () => t.result.answer.diagnostics, xt, (w, O) => {
        var A = C8(), R = M(A);
        {
          var W = (V) => {
            g3(V, { class: "mt-px size-3.5 shrink-0" });
          }, q = (V) => {
            Sg(V, { class: "mt-px size-3.5 shrink-0" });
          };
          D(R, (V) => {
            a(O).severity === "info" ? V(W) : V(q, -1);
          });
        }
        var P = m(R, 2), H = j(P, !0);
        L(() => {
          Ye(A, 1, `flex items-start gap-1.5 text-xs ${a(O).severity === "error" ? "text-destructive" : a(O).severity === "warning" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`), N(H, a(O).message);
        }), x(w, A);
      });
      var $ = m(b, 2);
      {
        var E = (w) => {
          var O = O8();
          x(w, O);
        };
        D($, (w) => {
          t.result.blocks.length === 0 && w(E);
        });
      }
      var C = m($, 2);
      Ae(C, 17, () => t.result.blocks, (w) => w.block.id, (w, O) => {
        m8(w, {
          get shown() {
            return a(O);
          },
          get result() {
            return t.result;
          },
          get onboard() {
            return t.onboard;
          }
        });
      }), x(k, S);
    };
    D(g, (k) => {
      t.result.state === "failed" ? k(y) : k(_, -1);
    });
  }
  L(() => {
    $e(n, "id", `adapter-${t.result.adapter ?? ""}`), N(l, t.result.adapter);
  }), x(e, n), Me();
}
var R8 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Bu(e, t) {
  let r = /* @__PURE__ */ K(t, R8);
  const n = {
    name: "archive",
    size: 24,
    node: [
      [
        "rect",
        { width: "20", height: "5", x: "2", y: "3", rx: "1" }
      ],
      ["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }],
      ["path", { d: "M10 12h4" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var D8 = /* @__PURE__ */ z('<code class="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]"> </code>'), L8 = /* @__PURE__ */ z('<button type="button" class="font-medium underline underline-offset-2"> </button>'), j8 = /* @__PURE__ */ z('<a class="break-all underline underline-offset-2" target="_blank" rel="noreferrer"> </a>'), Bf = /* @__PURE__ */ z("<p><!></p>"), V8 = /* @__PURE__ */ z("<li><!></li>"), F8 = /* @__PURE__ */ z('<ul class="flex list-disc flex-col gap-1 pl-5"></ul>'), Z8 = /* @__PURE__ */ z('<pre class="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs"> </pre>'), U8 = /* @__PURE__ */ z('<div class="flex flex-col gap-3 text-sm leading-relaxed break-words"></div>');
function Fs(e, t) {
  Ee(t, !0);
  const r = (s, i = dt) => {
    var l = Ze(), c = re(l);
    Ae(c, 17, i, xt, (u, d) => {
      var f = Ze(), h = re(f);
      {
        var p = (_) => {
          var k = D8(), S = j(k, !0);
          L(() => N(S, a(d).text)), x(_, k);
        }, v = (_) => {
          var k = L8(), S = j(k, !0);
          L((b) => N(S, b), [() => t.titleOf(a(d).id) ?? a(d).id]), ht("click", k, () => t.onselect(a(d).id)), x(_, k);
        }, g = (_) => {
          var k = j8(), S = j(k, !0);
          L(() => {
            $e(k, "href", a(d).href), N(S, a(d).text);
          }), x(_, k);
        }, y = (_) => {
          var k = ct();
          L(() => N(k, a(d).text)), x(_, k);
        };
        D(h, (_) => {
          a(d).kind === "code" ? _(p) : a(d).kind === "mention" ? _(v, 1) : a(d).kind === "link" ? _(g, 2) : _(y, -1);
        });
      }
      x(u, f);
    }), x(s, l);
  }, n = /* @__PURE__ */ T(() => dz(t.content));
  var o = U8();
  Ae(o, 21, () => a(n), xt, (s, i) => {
    var l = Ze(), c = re(l);
    {
      var u = (p) => {
        var v = Bf(), g = M(v);
        r(g, () => a(i).text), L(() => Ye(v, 1, `font-semibold ${a(i).level <= 2 ? "text-base" : ""}`)), x(p, v);
      }, d = (p) => {
        var v = Bf(), g = M(v);
        r(g, () => a(i).text), x(p, v);
      }, f = (p) => {
        var v = F8();
        Ae(v, 21, () => a(i).items, xt, (g, y) => {
          var _ = V8(), k = M(_);
          r(k, () => a(y)), x(g, _);
        }), x(p, v);
      }, h = (p) => {
        var v = Z8(), g = j(v, !0);
        L(() => N(g, a(i).text)), x(p, v);
      };
      D(c, (p) => {
        a(i).kind === "heading" ? p(u) : a(i).kind === "paragraph" ? p(d, 1) : a(i).kind === "list" ? p(f, 2) : p(h, -1);
      });
    }
    x(s, l);
  }), x(e, o), Me();
}
Lt(["click"]);
var B8 = /* @__PURE__ */ z('<button type="button"> </button>'), W8 = /* @__PURE__ */ z('<div class="flex flex-wrap items-center gap-1.5 text-xs"><span class="text-muted-foreground">Rests on</span> <!></div>'), H8 = /* @__PURE__ */ z("<!> from the cache", 1), q8 = /* @__PURE__ */ z('<section class="bg-card flex flex-col gap-2 rounded-lg border p-4" aria-label="Summary"><h3 class="section-title">Summary</h3> <!> <!> <p class="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">Written by <code class="font-mono"> </code> from the results below, which remain the record. <!></p></section>'), G8 = /* @__PURE__ */ z('<div><!> <div class="flex min-w-0 flex-1 flex-col gap-1"><span class="font-medium">No summary - the results below are complete without one.</span> <!></div></div>');
function K8(e, t) {
  Ee(t, !0);
  const r = zr(), n = /* @__PURE__ */ T(() => new Map(r.graph?.entities.map((f) => [f.id, f]) ?? [])), o = /* @__PURE__ */ T(() => t.outcome.synthesis), s = /* @__PURE__ */ T(() => [...new Set(a(o)?.citedEvidence ?? [])].flatMap((f) => {
    const h = r.ask.evidence.get(f), p = t.outcome.results.find((v) => v.adapter === h?.adapter);
    return h && p?.state === "answered" ? [
      {
        id: f,
        item: h,
        label: `${h.adapter} ${Pu(p, f)}`
      }
    ] : [];
  })), i = (f) => {
    const h = new Date(f);
    return Number.isNaN(h.getTime()) ? f : h.toLocaleString(void 0, { dateStyle: "medium", timeStyle: "short" });
  };
  var l = Ze(), c = re(l);
  {
    var u = (f) => {
      var h = q8(), p = m(M(h), 2);
      {
        let $ = /* @__PURE__ */ T(() => Pg(a(o).text, new Set(a(o).citedEntities)));
        Fs(p, {
          get content() {
            return a($);
          },
          titleOf: (E) => a(n).get(E)?.title,
          onselect: (E) => r.select(E)
        });
      }
      var v = m(p, 2);
      {
        var g = ($) => {
          var E = W8(), C = m(M(E), 2);
          Ae(C, 17, () => a(s), ({ id: w, item: O, label: A }) => w, (w, O) => {
            let A = () => a(O).id, R = () => a(O).item, W = () => a(O).label;
            var q = B8(), P = j(q, !0);
            L(() => {
              Ye(q, 1, `hover:bg-muted rounded border px-1.5 font-mono text-[11px] ${R().evidence.kind === "derived-fact" ? "border-dashed border-amber-600/60" : ""}`), $e(q, "title", R().evidence.text), N(P, W());
            }), ht("click", q, () => r.inspectEvidence(A())), x(w, q);
          }), x($, E);
        };
        D(v, ($) => {
          a(s).length > 0 && $(g);
        });
      }
      var y = m(v, 2), _ = m(M(y)), k = j(_, !0), S = m(_, 2);
      {
        var b = ($) => {
          {
            let E = /* @__PURE__ */ T(() => a(o).createdAt ? `Written ${i(a(o).createdAt)}` : void 0);
            Jt($, {
              variant: "outline",
              class: "gap-1 text-[10px]",
              get title() {
                return a(E);
              },
              children: (C, w) => {
                var O = H8(), A = re(O);
                Bu(A, { class: "size-3" }), x(C, O);
              },
              $$slots: { default: !0 }
            });
          }
        };
        D(S, ($) => {
          a(o).cached && $(b);
        });
      }
      L(() => N(k, a(o).model)), x(f, h);
    }, d = (f) => {
      var h = G8(), p = M(h);
      {
        let y = /* @__PURE__ */ T(() => t.outcome.notice.reason === "failed" ? "text-destructive" : "text-amber-600 dark:text-amber-400");
        or(p, {
          get class() {
            return `mt-0.5 size-4 shrink-0 ${a(y) ?? ""}`;
          }
        });
      }
      var v = m(p, 2), g = m(M(v), 2);
      Fs(g, {
        get content() {
          return t.outcome.notice.message;
        },
        titleOf: (y) => a(n).get(y)?.title,
        onselect: (y) => r.select(y)
      }), L(() => Ye(h, 1, `flex gap-2 rounded-md border p-3 text-xs ${t.outcome.notice.reason === "failed" ? "border-destructive/40" : "border-amber-500/40 bg-amber-500/10"}`)), x(f, h);
    };
    D(c, (f) => {
      a(o) ? f(u) : t.outcome.notice && t.outcome.notice.reason !== "disabled" && f(d, 1);
    });
  }
  x(e, l), Me();
}
Lt(["click"]);
var Y8 = /* @__PURE__ */ z("<!> Cancel", 1), X8 = /* @__PURE__ */ z("<!> Ask", 1), J8 = /* @__PURE__ */ z('<span class="text-destructive">· unavailable</span>'), Q8 = /* @__PURE__ */ z('<label><!> <span class="font-mono"> </span> <!></label>'), eT = /* @__PURE__ */ z('<fieldset class="flex flex-wrap items-center gap-1.5"><legend class="text-muted-foreground float-left mr-1">Ask</legend> <!> <!></fieldset>'), tT = /* @__PURE__ */ z('<span class="text-muted-foreground">Asks every adapter configured for query in <code class="font-mono">.docket.yaml</code>.</span>'), rT = /* @__PURE__ */ z('<li class="text-muted-foreground flex items-center gap-1 rounded-full border px-2 py-0.5"><!> <span class="font-mono"> </span></li>'), nT = /* @__PURE__ */ z('<ul class="flex flex-wrap gap-1.5 text-xs"></ul>'), oT = /* @__PURE__ */ z('<div class="flex flex-col gap-2 rounded-md border p-3 text-sm" role="status" aria-live="polite"><p class="flex items-center gap-2 font-serif italic"><!> </p> <!></div>'), sT = /* @__PURE__ */ z('<div class="border-destructive/40 text-destructive flex gap-2 rounded-md border p-3 text-sm"><!> <span class="break-words"> </span></div>'), iT = /* @__PURE__ */ z('<li><a><!> <span class="font-mono"> </span> <span class="text-muted-foreground"> </span></a></li>'), aT = /* @__PURE__ */ z('<li class="text-muted-foreground">No adapter is configured to answer questions.</li>'), lT = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs">Answered through <code class="font-mono">docket search</code> </p>'), cT = /* @__PURE__ */ z('<p><!><span class="break-words"> </span></p>'), uT = /* @__PURE__ */ z('<li class="bg-background flex flex-col rounded-md border px-3 py-2"><span class="font-serif text-2xl font-semibold tabular-nums"> <span class="text-muted-foreground text-sm font-normal"> </span></span> <span class="text-muted-foreground text-xs"><span class="font-mono"> </span> </span></li>'), dT = /* @__PURE__ */ z(`<p class="text-muted-foreground text-xs">Shown side by side, not averaged: each adapter counted differently. Check each one's evidence below.</p>`), fT = /* @__PURE__ */ z('<section><h3 class="flex items-center gap-1.5 text-sm font-medium"><!> </h3> <ul class="flex flex-wrap gap-3"></ul> <!></section>'), hT = /* @__PURE__ */ z("<!> Show on the board", 1), pT = /* @__PURE__ */ z('<span class="text-muted-foreground inline-flex items-center gap-0.5 font-mono"><!> <!></span>'), vT = /* @__PURE__ */ z('<button type="button" class="hover:bg-muted rounded px-1 py-0.5 font-medium"> </button> <!>', 1), gT = /* @__PURE__ */ z('<li class="flex flex-wrap items-center gap-1 text-xs"></li>'), mT = /* @__PURE__ */ z('<section class="flex flex-col gap-2 rounded-lg border p-4"><div class="flex flex-wrap items-center gap-2"><h3 class="section-title">How they connect</h3> <span class="text-muted-foreground text-xs">relationships in the canonical files, between what the adapters found</span> <!></div> <ul class="flex flex-col gap-1.5"></ul> <!></section>'), bT = /* @__PURE__ */ z('<div><div class="flex flex-col gap-2"><p class="flex gap-2.5"><span class="text-gilt font-serif font-semibold">Q.</span><span class="font-serif text-lg italic"> </span></p> <ul class="flex flex-wrap gap-1.5 text-xs" aria-label="Adapters asked"></ul> <!> <!></div> <!> <!> <!> <!></div>'), xT = /* @__PURE__ */ z('<div class="text-muted-foreground flex flex-col gap-2 rounded-lg border border-dashed p-5 text-sm"><p class="text-foreground font-serif text-lg">Put a question to every configured adapter</p> <p>Results fill this page: exhibits, passages, facts, counts, tables, timelines and graphs, each linked to its evidence.</p> <div class="flex flex-wrap gap-1.5"></div></div>'), yT = /* @__PURE__ */ z(`<div class="h-full min-h-0 overflow-y-auto"><div class="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6"><form class="flex flex-col gap-2.5"><label for="ask-question" class="font-serif text-xl font-semibold">Ask the adapters</label> <div class="flex gap-2"><!> <!></div> <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"><label class="flex items-center gap-1.5"><!> Summarise the results with a model</label> <!></div> <p class="text-muted-foreground text-xs">Each adapter answers in its own way - search hits, passages, facts, counts, graphs - and each answer is shown as it came,
        with its evidence. To find an exhibit by name in the loaded files instead, use <span class="font-medium">Find in the casebook</span> at the top.</p></form> <!> <!> <!></div></div>`);
function _T(e, t) {
  Ee(t, !0);
  const r = zr(), n = p3(), o = r.ask, s = /* @__PURE__ */ T(() => xg(t.graph));
  _3({
    get casebook() {
      return a(s);
    },
    label: Pu
  }), os(() => {
    r.loadAdapters();
  });
  const i = /* @__PURE__ */ T(() => r.adapters?.state === "ready" ? r.adapters.response : null), l = /* @__PURE__ */ T(() => a(i)?.adapters.filter((G) => G.roles.includes("query")) ?? []), c = /* @__PURE__ */ T(() => a(i)?.query.defaultAdapters ?? []), u = /* @__PURE__ */ T(() => new Set(o.adapters ?? a(c)));
  function d(G, ve) {
    const ke = a(l).map((ye) => ye.id).filter((ye) => ye === G ? ve : a(u).has(ye)), se = ke.length === a(c).length && ke.every((ye) => a(c).includes(ye));
    o.adapters = se ? null : ke;
  }
  const f = /* @__PURE__ */ T(() => o.outcome), h = /* @__PURE__ */ T(() => a(f) ? X4(a(f)) : []), p = (G) => t.graph.entities.find((ve) => ve.id === G)?.title ?? G, v = /* @__PURE__ */ T(() => o.pending ? o.pending.adapters ?? (a(i) ? a(c) : null) : null);
  function g(G) {
    G.preventDefault();
    const ve = o.question.trim();
    ve === "" || o.adapters !== null && o.adapters.length === 0 || o.ask(ve);
  }
  async function y(G) {
    await n.go("browse"), r.showScope(G);
  }
  const _ = /* @__PURE__ */ T(() => !a(f) || a(f).connections.length === 0 ? null : {
    label: `the canonical paths joining what was found for “${a(f).question}”`,
    ids: [
      ...new Set(a(f).connections.flatMap((G) => G.nodes))
    ],
    links: a(f).connections.flatMap((G) => G.steps.map((ve, ke) => {
      const [se, ye] = [G.nodes[ke] ?? "", G.nodes[ke + 1] ?? ""];
      return ve.forward ? { source: se, rel: ve.rel, target: ye } : { source: ye, rel: ve.rel, target: se };
    }))
  }), k = 5;
  let S = /* @__PURE__ */ he(!1);
  const b = [
    "Why is order state in Postgres?",
    "What does checkout depend on?",
    "Who owns the orders service?"
  ];
  var $ = yT(), E = M($), C = M(E), w = m(M(C), 2), O = M(w);
  Tu(O, {
    id: "ask-question",
    placeholder: "How many times was orders deployed in the last four weeks?",
    autocomplete: "off",
    class: "h-10 text-base",
    get value() {
      return o.question;
    },
    set value(G) {
      o.question = G;
    }
  });
  var A = m(O, 2);
  {
    var R = (G) => {
      ft(G, {
        type: "button",
        variant: "outline",
        size: "lg",
        onclick: () => o.cancel(),
        children: (ve, ke) => {
          var se = Y8(), ye = re(se);
          VS(ye, {}), x(ve, se);
        },
        $$slots: { default: !0 }
      });
    }, W = (G) => {
      {
        let ve = /* @__PURE__ */ T(() => o.question.trim() === "" || o.adapters !== null && o.adapters.length === 0);
        ft(G, {
          type: "submit",
          size: "lg",
          get disabled() {
            return a(ve);
          },
          children: (ke, se) => {
            var ye = X8(), U = re(ye);
            Xv(U, {}), x(ke, ye);
          },
          $$slots: { default: !0 }
        });
      }
    };
    D(A, (G) => {
      o.pending ? G(R) : G(W, -1);
    });
  }
  var q = m(w, 2), P = M(q), H = M(P);
  ua(H, {
    get checked() {
      return o.synthesis;
    },
    set checked(G) {
      o.synthesis = G;
    }
  });
  var V = m(P, 2);
  {
    var Y = (G) => {
      var ve = eT(), ke = m(M(ve), 2);
      Ae(ke, 17, () => a(l), (U) => U.id, (U, ee) => {
        var ue = Q8(), me = M(ue);
        {
          let De = /* @__PURE__ */ T(() => a(u).has(a(ee).id));
          ua(me, {
            get checked() {
              return a(De);
            },
            onCheckedChange: (ce) => d(a(ee).id, ce === !0),
            class: "size-3.5"
          });
        }
        var Re = m(me, 2), Ve = j(Re, !0), _e = m(Re, 2);
        {
          var Le = (De) => {
            var ce = J8();
            x(De, ce);
          };
          D(_e, (De) => {
            a(ee).status?.state === "unavailable" && De(Le);
          });
        }
        L(
          (De) => {
            Ye(ue, 1, `flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-1 ${De ?? ""}`), $e(ue, "title", a(ee).status ? `${a(ee).status.state}: ${a(ee).status.message}` : a(ee).module), N(Ve, a(ee).id);
          },
          [
            () => a(u).has(a(ee).id) ? "bg-accent" : "text-muted-foreground"
          ]
        ), x(U, ue);
      });
      var se = m(ke, 2);
      {
        var ye = (U) => {
          ft(U, {
            variant: "ghost",
            size: "xs",
            onclick: () => o.adapters = null,
            children: (ee, ue) => {
              var me = ct("Use the defaults");
              x(ee, me);
            },
            $$slots: { default: !0 }
          });
        };
        D(se, (U) => {
          o.adapters !== null && U(ye);
        });
      }
      x(G, ve);
    }, oe = (G) => {
      var ve = tT();
      x(G, ve);
    };
    D(V, (G) => {
      a(l).length > 0 ? G(Y) : r.adapters && r.adapters.state !== "ready" && G(oe, 1);
    });
  }
  var X = m(C, 2);
  {
    var I = (G) => {
      var ve = oT(), ke = M(ve), se = M(ke);
      Bn(se, { class: "size-4 animate-spin" });
      var ye = m(se), U = m(ke, 2);
      {
        var ee = (ue) => {
          var me = nT();
          Ae(me, 20, () => a(v), (Re) => Re, (Re, Ve) => {
            var _e = rT(), Le = M(_e);
            Bn(Le, { class: "size-3 animate-spin" });
            var De = m(Le, 2), ce = j(De, !0);
            L(() => N(ce, Ve)), x(Re, _e);
          }), x(ue, me);
        };
        D(U, (ue) => {
          a(v) && ue(ee);
        });
      }
      L(() => N(ye, ` Asking “${o.pending.question ?? ""}”…`)), x(G, ve);
    };
    D(X, (G) => {
      o.pending && G(I);
    });
  }
  var te = m(X, 2);
  {
    var F = (G) => {
      var ve = sT(), ke = M(ve);
      or(ke, { class: "mt-0.5 size-4 shrink-0" });
      var se = m(ke, 2), ye = j(se, !0);
      L(() => N(ye, o.failure)), x(G, ve);
    };
    D(te, (G) => {
      o.failure && G(F);
    });
  }
  var Q = m(te, 2);
  {
    var pe = (G) => {
      var ve = bT(), ke = M(ve), se = M(ke), ye = m(M(se)), U = j(ye, !0), ee = m(se, 2);
      Ae(
        ee,
        21,
        () => a(f).results,
        (xe) => xe.adapter,
        (xe, Se) => {
          var ze = iT(), de = M(ze), we = M(de);
          {
            var je = (ge) => {
              Xs(ge, { class: "size-3" });
            }, Fe = (ge) => {
              iu(ge, { class: "size-3 text-emerald-600" });
            };
            D(we, (ge) => {
              a(Se).state === "failed" ? ge(je) : ge(Fe, -1);
            });
          }
          var Xe = m(we, 2), ie = j(Xe, !0), B = m(Xe, 2), ne = j(B, !0);
          L(() => {
            $e(de, "href", `#adapter-${a(Se).adapter ?? ""}`), Ye(de, 1, `hover:bg-muted flex items-center gap-1 rounded-full border px-2 py-0.5 ${a(Se).state === "failed" ? "border-destructive/50 text-destructive" : ""}`), N(ie, a(Se).adapter), N(ne, a(Se).state === "failed" ? a(Se).error.code : `${a(Se).blocks.length} ${a(Se).blocks.length === 1 ? "result" : "results"}`);
          }), ht("click", de, (ge) => {
            ge.preventDefault(), ge.currentTarget.getRootNode().getElementById(`adapter-${a(Se).adapter}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }), x(xe, ze);
        },
        (xe) => {
          var Se = aT();
          x(xe, Se);
        }
      );
      var ue = m(ee, 2);
      {
        var me = (xe) => {
          var Se = lT(), ze = m(M(Se), 2);
          L(() => N(ze, `${a(f).via === "legacy-chat" ? " and chat" : ""}: this docket does
              not serve the adapter coordinator yet, so each adapter's answer is its exhibit hits.`)), x(xe, Se);
        };
        D(ue, (xe) => {
          a(f).via !== "coordinator" && xe(me);
        });
      }
      var Re = m(ue, 2);
      Ae(Re, 17, () => a(f).diagnostics, xt, (xe, Se) => {
        var ze = cT(), de = M(ze);
        or(de, { class: "mt-px size-3.5 shrink-0" });
        var we = m(de), je = j(we, !0);
        L(() => {
          Ye(ze, 1, `flex items-start gap-1.5 text-xs ${a(Se).severity === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`), N(je, a(Se).message);
        }), x(xe, ze);
      });
      var Ve = m(ke, 2);
      K8(Ve, {
        get outcome() {
          return a(f);
        }
      });
      var _e = m(Ve, 2);
      Ae(_e, 17, () => a(h), (xe) => xe.label, (xe, Se) => {
        var ze = fT(), de = M(ze), we = M(de);
        Yv(we, { class: "size-4" });
        var je = m(we), Fe = m(de, 2);
        Ae(Fe, 21, () => a(Se).readings, (B) => `${B.adapter}\0${B.blockId}`, (B, ne) => {
          var ge = uT(), Te = M(ge), Ie = M(Te), qe = m(Ie), Je = j(qe, !0), at = m(Te, 2), Ot = M(at), gt = j(Ot, !0), st = m(Ot);
          L(
            (lt) => {
              N(Ie, `${lt ?? ""} `), N(Je, a(ne).unit ?? ""), N(gt, a(ne).adapter), N(st, ` ·
                    ${a(ne).coverage === "exhaustive" ? "exhaustive" : a(ne).coverage === "top-k" ? "from a sample - not a full count" : "coverage unknown"}`);
            },
            [() => a(ne).value.toLocaleString()]
          ), x(B, ge);
        });
        var Xe = m(Fe, 2);
        {
          var ie = (B) => {
            var ne = dT();
            x(B, ne);
          };
          D(Xe, (B) => {
            a(Se).agree || B(ie);
          });
        }
        L(() => {
          Ye(ze, 1, `flex flex-col gap-2 rounded-lg border p-4 ${a(Se).agree ? "" : "border-amber-500/50 bg-amber-500/5"}`), $e(ze, "aria-label", `Adapters compared on ${a(Se).label ?? ""}`), N(je, ` ${a(Se).agree ? "Adapters agree" : "Adapters disagree"}: ${a(Se).label ?? ""}`);
        }), x(xe, ze);
      });
      var Le = m(_e, 2);
      Ae(Le, 17, () => a(f).results, (xe) => xe.adapter, (xe, Se) => {
        I8(xe, {
          get result() {
            return a(Se);
          },
          onboard: y
        });
      });
      var De = m(Le, 2);
      {
        var ce = (xe) => {
          const Se = /* @__PURE__ */ T(() => a(_));
          var ze = mT(), de = M(ze), we = m(M(de), 4);
          ft(we, {
            variant: "ghost",
            size: "xs",
            class: "ml-auto",
            onclick: () => y(a(Se)),
            children: (ie, B) => {
              var ne = hT(), ge = re(ne);
              Ys(ge, {}), x(ie, ne);
            },
            $$slots: { default: !0 }
          });
          var je = m(de, 2);
          Ae(
            je,
            21,
            () => a(S) ? a(f).connections : a(f).connections.slice(0, k),
            xt,
            (ie, B) => {
              var ne = gT();
              Ae(ne, 21, () => a(B).nodes, xt, (ge, Te, Ie) => {
                var qe = vT(), Je = re(qe), at = j(Je, !0), Ot = m(Je, 2);
                {
                  var gt = (st) => {
                    const lt = /* @__PURE__ */ T(() => a(B).steps[Ie]);
                    var er = pT(), ar = M(er);
                    {
                      var Ar = (Ft) => {
                        Kv(Ft, { class: "size-3" });
                      };
                      D(ar, (Ft) => {
                        a(lt).forward || Ft(Ar);
                      });
                    }
                    var mr = m(ar, 1, !0), Er = m(mr);
                    {
                      var Mr = (Ft) => {
                        Gn(Ft, { class: "size-3" });
                      };
                      D(Er, (Ft) => {
                        a(lt).forward && Ft(Mr);
                      });
                    }
                    L(() => N(mr, a(lt).rel)), x(st, er);
                  };
                  D(Ot, (st) => {
                    a(B).steps[Ie] && st(gt);
                  });
                }
                L((st) => N(at, st), [() => p(a(Te))]), ht("click", Je, () => r.select(a(Te))), x(ge, qe);
              }), x(ie, ne);
            }
          );
          var Fe = m(je, 2);
          {
            var Xe = (ie) => {
              ft(ie, {
                variant: "ghost",
                size: "xs",
                class: "self-start",
                onclick: () => Z(S, !a(S)),
                children: (B, ne) => {
                  var ge = ct();
                  L(() => N(ge, a(S) ? "Show fewer" : `Show all ${a(f).connections.length} paths`)), x(B, ge);
                },
                $$slots: { default: !0 }
              });
            };
            D(Fe, (ie) => {
              a(f).connections.length > k && ie(Xe);
            });
          }
          x(xe, ze);
        };
        D(De, (xe) => {
          a(f).connections.length > 0 && a(_) && xe(ce);
        });
      }
      L(() => {
        Ye(ve, 1, `flex flex-col gap-5 transition-opacity ${o.pending ? "opacity-50" : ""}`), N(U, a(f).question);
      }), x(G, ve);
    }, fe = (G) => {
      var ve = xT(), ke = m(M(ve), 4);
      Ae(ke, 20, () => b, (se) => se, (se, ye) => {
        ft(se, {
          variant: "outline",
          size: "xs",
          onclick: () => o.question = ye,
          children: (U, ee) => {
            var ue = ct();
            L(() => N(ue, ye)), x(U, ue);
          },
          $$slots: { default: !0 }
        });
      }), x(G, ve);
    };
    D(Q, (G) => {
      a(f) ? G(pe) : o.pending || G(fe, 1);
    });
  }
  jn("submit", C, g), x(e, $), Me();
}
Lt(["click"]);
var wT = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function kT(e, t) {
  let r = /* @__PURE__ */ K(t, wT);
  const n = {
    name: "panel-left",
    size: 24,
    node: [
      [
        "rect",
        { width: "18", height: "18", x: "3", y: "3", rx: "2" }
      ],
      ["path", { d: "M9 3v18" }]
    ],
    aliases: ["sidebar"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var ST = /* @__PURE__ */ z('<div class="flex items-center gap-0.5 text-xs" role="group"><button type="button" class="text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:bg-muted rounded px-1.5 py-0.5">All</button> <button type="button" class="text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:bg-muted rounded px-1.5 py-0.5">None</button></div>'), $T = /* @__PURE__ */ z('<p class="text-muted-foreground px-1 text-xs">None yet.</p>'), zT = /* @__PURE__ */ z('<li class="group hover:bg-muted flex items-center gap-2 rounded-md px-1 py-1"><!> <!> <label> </label> <button type="button" class="text-muted-foreground hover:text-foreground hidden text-[11px] group-hover:inline">only</button> <span class="text-muted-foreground text-xs tabular-nums"> </span></li>'), AT = /* @__PURE__ */ z('<section class="flex flex-col gap-1"><div class="flex items-center justify-between gap-2 px-1"><h3 class="section-title"> </h3> <!></div> <!> <ul class="flex flex-col"></ul></section>'), ET = /* @__PURE__ */ z('<section class="flex flex-col gap-1"><h3 class="section-title px-1">References</h3> <div class="hover:bg-muted flex items-center gap-2 rounded-md px-1 py-1"><!> <!> <label for="show-unresolved" class="flex-1 cursor-pointer text-sm">Unresolved targets</label> <span class="text-muted-foreground text-xs tabular-nums"> </span></div> <p class="text-muted-foreground px-1 text-xs">Cited by an exhibit, but no file in the casebook defines them yet.</p></section>'), MT = /* @__PURE__ */ z('<div class="flex flex-col gap-5 p-3"><!> <!> <!></div>');
function TT(e, t) {
  Ee(t, !0);
  const r = (k, S = dt, b = dt, $ = dt, E = dt, C = dt) => {
    const w = /* @__PURE__ */ T(() => b().map(([X]) => X)), O = /* @__PURE__ */ T(() => a(w).filter((X) => !$().has(X)).length);
    var A = AT(), R = M(A), W = M(R), q = j(W, !0), P = m(W, 2);
    {
      var H = (X) => {
        var I = ST(), te = M(I), F = m(te, 2);
        L(() => {
          $e(I, "aria-label", `${S() ?? ""}: switch all`), $e(te, "aria-pressed", a(O) === a(w).length), $e(F, "aria-pressed", a(O) === 0);
        }), ht("click", te, () => f($(), a(w), !0)), ht("click", F, () => f($(), a(w), !1)), x(X, I);
      };
      D(P, (X) => {
        a(w).length > 0 && X(H);
      });
    }
    var V = m(R, 2);
    {
      var Y = (X) => {
        var I = $T();
        x(X, I);
      };
      D(V, (X) => {
        b().length === 0 && X(Y);
      });
    }
    var oe = m(V, 2);
    Ae(oe, 21, b, ([X, I]) => X, (X, I) => {
      var te = /* @__PURE__ */ T(() => fr(a(I), 2));
      let F = () => a(te)[0], Q = () => a(te)[1];
      const pe = /* @__PURE__ */ T(() => `${S()}-${F()}`);
      var fe = zT(), G = M(fe);
      {
        let me = /* @__PURE__ */ T(() => !$().has(F()));
        ua(G, {
          get id() {
            return a(pe);
          },
          get checked() {
            return a(me);
          },
          onCheckedChange: (Re) => d($(), F(), Re === !0)
        });
      }
      var ve = m(G, 2);
      {
        var ke = (me) => {
          {
            let Re = /* @__PURE__ */ T(() => $().has(F()) ? "opacity-40" : "");
            vr(me, {
              get type() {
                return F();
              },
              size: "sm",
              get class() {
                return a(Re);
              }
            });
          }
        };
        D(ve, (me) => {
          C() && me(ke);
        });
      }
      var se = m(ve, 2), ye = j(se, !0), U = m(se, 2), ee = m(U, 2), ue = j(ee, !0);
      L(
        (me) => {
          $e(fe, "title", me), $e(se, "for", a(pe)), Ye(se, 1, `min-w-0 flex-1 cursor-pointer truncate text-sm ${C() ? "" : "font-mono text-xs"}`), N(ye, F()), N(ue, Q());
        },
        [() => E().get(F()) || void 0]
      ), ht("click", U, () => h($(), b().map(([me]) => me), F())), x(X, fe);
    }), L(() => N(q, S())), x(k, A);
  };
  let n = be(t, "showUnresolved", 15);
  const o = (k) => new Map(k.map((S) => [S.name, S.description ?? ""])), s = /* @__PURE__ */ T(() => [...nc(t.graph.entities, (k) => k.type)].sort(([k, S], [b, $]) => $ - S || (k < b ? -1 : 1))), i = /* @__PURE__ */ T(() => [...nc(t.graph.edges, (k) => k.rel)].sort(([k, S], [b, $]) => $ - S || (k < b ? -1 : 1))), l = /* @__PURE__ */ T(() => o(t.graph.types)), c = /* @__PURE__ */ T(() => o(t.graph.relationships)), u = /* @__PURE__ */ T(() => new Set(t.graph.edges.filter((k) => k.dangling).map((k) => k.target)).size), d = (k, S, b) => {
    b ? k.delete(S) : k.add(S);
  }, f = (k, S, b) => {
    if (k.clear(), !b) for (const $ of S) k.add($);
  }, h = (k, S, b) => {
    const $ = !k.has(b) && S.every((E) => E === b || k.has(E));
    if (k.clear(), !$) for (const E of S) E !== b && k.add(E);
  };
  var p = MT(), v = M(p);
  r(v, () => "Exhibit types", () => a(s), () => t.hiddenTypes, () => a(l), () => !0);
  var g = m(v, 2);
  r(g, () => "Relationships", () => a(i), () => t.hiddenRels, () => a(c), () => !1);
  var y = m(g, 2);
  {
    var _ = (k) => {
      var S = ET(), b = m(M(S), 2), $ = M(b);
      ua($, {
        id: "show-unresolved",
        get checked() {
          return n();
        },
        set checked(O) {
          n(O);
        }
      });
      var E = m($, 2);
      vr(E, { type: null, size: "sm" });
      var C = m(E, 4), w = j(C, !0);
      L(() => N(w, a(u))), x(k, S);
    };
    D(y, (k) => {
      a(u) > 0 && k(_);
    });
  }
  x(e, p), Me();
}
Lt(["click"]);
const ii = (e) => {
  if (typeof e == "string")
    return /^\d{4}-\d{2}-\d{2}/.exec(e)?.[0];
}, cm = (e) => e >= 0.8 ? "high" : e >= 0.5 ? "medium" : "low", Co = (e) => typeof e == "string" && e !== "" ? e : void 0, CT = (e) => e.filter((t) => t !== void 0).sort().at(-1), OT = (e) => e.entities.map((t) => {
  const r = t.evidence.map((n) => Co(n.source)).filter((n) => n !== void 0);
  return {
    entity: t,
    sources: t.assessment?.sources.length ? t.assessment.sources : [...new Set(r)].sort(),
    ...t.assessment ? { confidence: t.assessment.confidence, basis: t.assessment.basis } : {},
    evidenceCount: t.assessment?.evidenceCount ?? t.evidence.length,
    ...hc("lastObserved", CT(t.evidence.map((n) => ii(n.observedAt))))
  };
}), hc = (e, t) => t === void 0 ? {} : { [e]: t }, um = (e) => e.entities.flatMap((t) => {
  const r = (n, o, s) => ({
    key: o,
    entity: t,
    ...s ? { link: s } : {},
    evidence: n,
    ...Co(n.source) ? { source: Co(n.source) } : {},
    location: Og(n),
    ...hc("observedAt", Co(n.observedAt)),
    ...hc("eventAt", Co(n.eventAt))
  });
  return [
    ...t.evidence.map((n, o) => r(n, `${t.id}#${o}`)),
    ...t.links.flatMap(
      (n, o) => (n.evidence ?? []).map(
        (s, i) => r(s, `${t.id}>${o}#${i}`, { rel: n.rel, target: n.target })
      )
    )
  ];
}), dm = (e, t) => !t.from && !t.to ? !0 : e === void 0 ? !1 : (!t.from || e >= t.from) && (!t.to || e <= t.to), fm = (e, t, r) => r === "any" ? !0 : r === "unevidenced" ? t === "unevidenced" : e !== void 0 && cm(e) === r, hm = (e, t) => {
  const r = t.toLowerCase().split(/\s+/).filter(Boolean), n = e.filter(Boolean).join(" ").toLowerCase();
  return r.every((o) => n.includes(o));
}, NT = (e, t) => e.filter(
  (r) => (t.types.size === 0 || t.types.has(r.entity.type)) && (t.sources.size === 0 || r.sources.some((n) => t.sources.has(n))) && // An exhibit is in a date range when any of its observations is.
  (!t.from && !t.to ? !0 : r.entity.evidence.some((n) => dm(ii(n.observedAt), t))) && fm(r.confidence, r.basis, t.assessment) && hm([r.entity.id, r.entity.title, r.entity.path, ...r.entity.tags], t.text)
), PT = (e, t) => e.filter(
  (r) => (t.types.size === 0 || t.types.has(r.entity.type)) && (t.sources.size === 0 || r.source !== void 0 && t.sources.has(r.source)) && dm(ii(r.observedAt), t) && fm(r.entity.assessment?.confidence, r.entity.assessment?.basis, t.assessment) && hm([r.entity.id, r.entity.title, r.location, r.link?.rel, r.link?.target, Co(r.evidence.note)], t.text)
), IT = (e) => um(e).flatMap(
  (t) => ["eventAt", "observedAt"].flatMap((r) => {
    const n = t[r], o = ii(n);
    if (n === void 0 || o === void 0) return [];
    const s = r === "eventAt" ? "event" : "observed";
    return [{ key: `${t.key}:${s}`, day: o, at: n, semantics: s, row: t }];
  })
).sort((t, r) => t.at < r.at ? 1 : t.at > r.at || t.key < r.key ? -1 : 1), RT = (e) => {
  const t = /* @__PURE__ */ new Map();
  for (const s of e)
    s.rel === "supersedes" && t.set(s.source, [...t.get(s.source) ?? [], s.target]);
  const r = new Set([...t.values()].flat()), n = [], o = (s) => {
    const i = s.at(-1) ?? "", l = (t.get(i) ?? []).filter((c) => !s.includes(c));
    l.length === 0 && n.push(s);
    for (const c of l.sort()) o([...s, c]);
  };
  for (const s of [...t.keys()].filter((i) => !r.has(i)).sort()) o([s]);
  return n;
};
var DT = /* @__PURE__ */ z('<span class="text-muted-foreground inline-flex items-center gap-1 text-xs"><!> supersedes</span>'), LT = /* @__PURE__ */ z('<!> <button type="button"><!> </button> <!>', 1), jT = /* @__PURE__ */ z('<li class="bg-card flex flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 text-sm"></li>'), VT = /* @__PURE__ */ z('<section class="flex flex-col gap-3"><h2 class="section-title text-base">Supersessions</h2> <p class="text-muted-foreground -mt-2 text-xs">From each <code class="font-mono">supersedes</code> relationship: the record in force first, then what it replaced.</p> <ol class="flex flex-col gap-2"></ol></section>'), FT = /* @__PURE__ */ z('<button type="button" role="tab"> </button>'), ZT = /* @__PURE__ */ z('No evidence records when what it saw happened (<code class="font-mono">eventAt</code>).', 1), UT = /* @__PURE__ */ z('No evidence records when it was observed (<code class="font-mono">observedAt</code>).', 1), BT = /* @__PURE__ */ z('No evidence on file is dated. Evidence with <code class="font-mono">observedAt</code> or <code class="font-mono">eventAt</code> shows here.', 1), WT = /* @__PURE__ */ z('<p class="text-muted-foreground rounded-md border border-dashed p-4 text-sm"><!></p>'), HT = /* @__PURE__ */ z('<span class="text-muted-foreground inline-flex items-center gap-1 font-mono text-xs"> <!> </span>'), qT = /* @__PURE__ */ z('<span class="break-words"> </span>'), GT = /* @__PURE__ */ z('<span class="font-mono"> </span>'), KT = /* @__PURE__ */ z('<span class="font-mono break-all"> </span>'), YT = /* @__PURE__ */ z("<span> </span>"), XT = /* @__PURE__ */ z('<li class="relative"><span aria-hidden="true"></span> <button type="button"><span class="flex flex-wrap items-center gap-1.5"><!> <!> <span class="font-medium"> </span> <!></span> <!> <span class="text-muted-foreground flex flex-wrap gap-x-2 text-xs"><!> <!> <!></span></button></li>'), JT = /* @__PURE__ */ z('<li class="grid grid-cols-[7rem_1fr] gap-3"><time class="text-muted-foreground pt-1.5 text-right font-serif text-sm"> </time> <ol class="flex flex-col gap-1.5 border-l pl-4"></ol></li>'), QT = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs"> </p>'), eC = /* @__PURE__ */ z('<ol class="flex flex-col gap-5"></ol> <!>', 1), tC = /* @__PURE__ */ z(`<div class="h-full min-h-0 overflow-auto"><div class="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-5"><!> <section class="flex flex-col gap-3"><div class="flex flex-wrap items-center justify-between gap-2"><h2 class="section-title text-base">Observations over time</h2> <div role="tablist" aria-label="Which times" class="bg-muted inline-flex rounded-lg p-0.5"></div></div> <p class="text-muted-foreground -mt-1 text-xs"><span class="font-medium text-foreground">Happened</span> is the evidence's <code class="font-mono">eventAt</code>, recorded only
        when known. <span class="font-medium text-foreground">Observed</span> is its <code class="font-mono">observedAt</code>: when someone
        or something saw it. Neither is ever inferred from a file's modification time.</p> <!></section></div></div>`);
function rC(e, t) {
  Ee(t, !0);
  const r = 120;
  let n = /* @__PURE__ */ he("all");
  const o = /* @__PURE__ */ T(() => new Map(t.graph.entities.map((b) => [b.id, b]))), s = /* @__PURE__ */ T(() => IT(t.graph).filter((b) => a(n) === "all" || b.semantics === a(n))), i = /* @__PURE__ */ T(() => {
    const b = /* @__PURE__ */ new Map();
    for (const $ of a(s)) b.set($.day, [...b.get($.day) ?? [], $]);
    return [...b.entries()];
  }), l = /* @__PURE__ */ T(() => RT(t.graph.edges)), c = (b) => {
    const $ = /* @__PURE__ */ new Date(`${b}T00:00:00`);
    return Number.isNaN($.getTime()) ? b : $.toLocaleDateString(void 0, { dateStyle: "medium" });
  }, u = (b) => {
    const $ = /T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(b);
    return !$ || b.endsWith("T00:00:00.000Z") ? null : `${$[1]}${$[2] ? ` ${$[2] === "Z" ? "UTC" : $[2]}` : ""}`;
  };
  var d = tC(), f = M(d), h = M(f);
  {
    var p = (b) => {
      var $ = VT(), E = m(M($), 4);
      Ae(E, 21, () => a(l), (C) => C.join(">"), (C, w) => {
        var O = jT();
        Ae(O, 22, () => a(w), (A) => A, (A, R, W) => {
          const q = /* @__PURE__ */ T(() => a(o).get(R));
          var P = LT(), H = re(P);
          {
            var V = (F) => {
              var Q = DT(), pe = M(Q);
              Gn(pe, { class: "size-3" }), x(F, Q);
            };
            D(H, (F) => {
              a(W) > 0 && F(V);
            });
          }
          var Y = m(H, 2), oe = M(Y);
          {
            let F = /* @__PURE__ */ T(() => a(q)?.type ?? null);
            vr(oe, {
              get type() {
                return a(F);
              },
              size: "sm"
            });
          }
          var X = m(oe), I = m(Y, 2);
          {
            var te = (F) => {
              Jt(F, {
                variant: "secondary",
                class: "text-[10px]",
                children: (Q, pe) => {
                  var fe = ct("current");
                  x(Q, fe);
                },
                $$slots: { default: !0 }
              });
            };
            D(I, (F) => {
              a(W) === 0 && F(te);
            });
          }
          L(() => {
            Ye(Y, 1, `hover:bg-muted inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 ${a(W) > 0 ? "text-muted-foreground line-through decoration-1" : "font-medium"} ${R === t.selected ? "bg-accent" : ""}`), N(X, ` ${a(q)?.title ?? R ?? ""}`);
          }), ht("click", Y, () => t.onselect(R)), x(A, P);
        }), x(C, O);
      }), x(b, $);
    };
    D(h, (b) => {
      a(l).length > 0 && b(p);
    });
  }
  var v = m(h, 2), g = M(v), y = m(M(g), 2);
  Ae(
    y,
    20,
    () => [
      ["all", "Both"],
      ["event", "When it happened"],
      ["observed", "When it was observed"]
    ],
    ([b, $]) => b,
    (b, $) => {
      var E = /* @__PURE__ */ T(() => fr($, 2));
      let C = () => a(E)[0], w = () => a(E)[1];
      var O = FT(), A = j(O, !0);
      L(() => {
        $e(O, "aria-selected", a(n) === C()), Ye(O, 1, `rounded-md px-2.5 py-1 text-xs ${a(n) === C() ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`), N(A, w());
      }), ht("click", O, () => Z(n, C(), !0)), x(b, O);
    }
  );
  var _ = m(g, 4);
  {
    var k = (b) => {
      var $ = WT(), E = M($);
      {
        var C = (A) => {
          var R = ZT();
          x(A, R);
        }, w = (A) => {
          var R = UT();
          x(A, R);
        }, O = (A) => {
          var R = BT();
          x(A, R);
        };
        D(E, (A) => {
          a(n) === "event" ? A(C) : a(n) === "observed" ? A(w, 1) : A(O, -1);
        });
      }
      x(b, $);
    }, S = (b) => {
      var $ = eC(), E = re($);
      Ae(E, 21, () => a(i).slice(0, r), ([O, A]) => O, (O, A) => {
        var R = /* @__PURE__ */ T(() => fr(a(A), 2));
        let W = () => a(R)[0], q = () => a(R)[1];
        var P = JT(), H = M(P), V = j(H, !0), Y = m(H, 2);
        Ae(Y, 21, q, (oe) => oe.key, (oe, X) => {
          const I = /* @__PURE__ */ T(() => u(a(X).at));
          var te = XT(), F = M(te), Q = m(F, 2), pe = M(Q), fe = M(pe);
          {
            let ce = /* @__PURE__ */ T(() => a(X).semantics === "event" ? "default" : "outline"), xe = /* @__PURE__ */ T(() => a(X).semantics === "event" ? "eventAt: when it happened" : "observedAt: when it was seen");
            Jt(fe, {
              get variant() {
                return a(ce);
              },
              class: "text-[10px]",
              get title() {
                return a(xe);
              },
              children: (Se, ze) => {
                var de = ct();
                L(() => N(de, `${a(X).semantics === "event" ? "happened" : "observed"}${a(I) ? ` ${a(I)}` : ""}`)), x(Se, de);
              },
              $$slots: { default: !0 }
            });
          }
          var G = m(fe, 2);
          vr(G, {
            get type() {
              return a(X).row.entity.type;
            },
            size: "sm"
          });
          var ve = m(G, 2), ke = j(ve, !0), se = m(ve, 2);
          {
            var ye = (ce) => {
              var xe = HT(), Se = M(xe), ze = m(Se);
              Gn(ze, { class: "size-3" });
              var de = m(ze, 1, !0);
              L(
                (we) => {
                  N(Se, a(X).row.link.rel), N(de, we);
                },
                [
                  () => a(o).get(a(X).row.link.target)?.title ?? a(X).row.link.target
                ]
              ), x(ce, xe);
            };
            D(se, (ce) => {
              a(X).row.link && ce(ye);
            });
          }
          var U = m(pe, 2);
          {
            var ee = (ce) => {
              var xe = qT(), Se = j(xe, !0);
              L(() => N(Se, a(X).row.evidence.note)), x(ce, xe);
            };
            D(U, (ce) => {
              typeof a(X).row.evidence.note == "string" && ce(ee);
            });
          }
          var ue = m(U, 2), me = M(ue);
          {
            var Re = (ce) => {
              var xe = GT(), Se = j(xe, !0);
              L(() => N(Se, a(X).row.source)), x(ce, xe);
            };
            D(me, (ce) => {
              a(X).row.source && ce(Re);
            });
          }
          var Ve = m(me, 2);
          {
            var _e = (ce) => {
              var xe = KT(), Se = j(xe, !0);
              L(() => N(Se, a(X).row.location)), x(ce, xe);
            };
            D(Ve, (ce) => {
              a(X).row.location && ce(_e);
            });
          }
          var Le = m(Ve, 2);
          {
            var De = (ce) => {
              var xe = YT(), Se = j(xe);
              L(() => N(Se, `by ${a(X).row.evidence.observedBy ?? ""}`)), x(ce, xe);
            };
            D(Le, (ce) => {
              typeof a(X).row.evidence.observedBy == "string" && ce(De);
            });
          }
          L(() => {
            Ye(F, 1, `absolute top-3 -left-[1.3rem] size-2 rounded-full ${a(X).semantics === "event" ? "bg-gilt" : "border-muted-foreground border bg-background"}`), Ye(Q, 1, `hover:bg-muted flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm ${a(X).row.entity.id === t.selected ? "bg-accent" : ""}`), N(ke, a(X).row.entity.title);
          }), ht("click", Q, () => t.onselect(a(X).row.entity.id)), x(oe, te);
        }), L(
          (oe) => {
            $e(H, "datetime", W()), N(V, oe);
          },
          [() => c(W())]
        ), x(O, P);
      });
      var C = m(E, 2);
      {
        var w = (O) => {
          var A = QT(), R = j(A);
          L(() => N(R, `Showing the latest 120 days of ${a(i).length ?? ""}.`)), x(O, A);
        };
        D(C, (O) => {
          a(i).length > r && O(w);
        });
      }
      x(b, $);
    };
    D(_, (b) => {
      a(i).length === 0 ? b(k) : b(S, -1);
    });
  }
  x(e, d), Me();
}
Lt(["click"]);
var nC = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function oC(e, t) {
  let r = /* @__PURE__ */ K(t, nC);
  const n = {
    name: "arrow-down",
    size: 24,
    node: [
      ["path", { d: "M12 5v14" }],
      ["path", { d: "m19 12-7 7-7-7" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var sC = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function iC(e, t) {
  let r = /* @__PURE__ */ K(t, sC);
  const n = {
    name: "arrow-up",
    size: 24,
    node: [
      ["path", { d: "m5 12 7-7 7 7" }],
      ["path", { d: "M12 19V5" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
const Cr = (e, t = dt, r = dt, n = dt, o = dt) => {
  var s = aC(), i = M(s), l = M(i), c = m(l);
  {
    var u = (d) => {
      var f = Ze(), h = re(f);
      {
        var p = (g) => {
          oC(g, { class: "size-3" });
        }, v = (g) => {
          iC(g, { class: "size-3" });
        };
        D(h, (g) => {
          n() ? g(p) : g(v, -1);
        });
      }
      x(d, f);
    };
    D(c, (d) => {
      r() && d(u);
    });
  }
  L(() => {
    $e(s, "aria-sort", r() ? n() ? "descending" : "ascending" : "none"), N(l, `${t() ?? ""} `);
  }), ht("click", i, function(...d) {
    o()?.apply(this, d);
  }), x(e, s);
};
var aC = /* @__PURE__ */ z('<th scope="col" class="px-3 py-2 font-medium"><button type="button" class="hover:text-foreground inline-flex items-center gap-1"> <!></button></th>'), lC = /* @__PURE__ */ z('<button type="button" role="tab"> </button>'), Wf = /* @__PURE__ */ z("<option> </option>"), cC = /* @__PURE__ */ z('<div class="text-muted-foreground p-6 text-sm"><!></div>'), uC = /* @__PURE__ */ z(' <span class="text-muted-foreground"> </span>', 1), dC = /* @__PURE__ */ z('<span class="text-muted-foreground">—</span>'), fC = /* @__PURE__ */ z('<tr><td class="px-3 py-2"><button type="button" class="flex min-w-0 items-center gap-2 text-left hover:underline"><!> <span class="flex min-w-0 flex-col"><span class="truncate font-medium"> </span> <span class="text-muted-foreground truncate font-mono text-xs"> </span></span></button></td><td class="text-muted-foreground px-3 py-2 text-xs"> </td><td class="px-3 py-2"><span class="flex flex-wrap gap-1"></span></td><td class="px-3 py-2 text-xs whitespace-nowrap tabular-nums"><!></td><td class="px-3 py-2 text-xs tabular-nums"> </td><td class="px-3 py-2 text-xs whitespace-nowrap tabular-nums"> </td><td class="text-muted-foreground max-w-64 truncate px-3 py-2 font-mono text-xs"> </td></tr>'), hC = /* @__PURE__ */ z('<table class="w-full border-collapse text-sm"><thead class="bg-background text-muted-foreground sticky top-0 z-10 text-left text-xs shadow-[0_1px_0_var(--border)]"><tr><!><!><th scope="col" class="px-3 py-2 font-medium">Sources</th><!><!><!><!></tr></thead><tbody></tbody></table>'), pC = /* @__PURE__ */ z('<span class="inline-flex items-center gap-1"><span class="font-mono"> </span><!> </span>'), vC = /* @__PURE__ */ z('<p class="text-foreground mt-0.5 break-words"> </p>'), gC = /* @__PURE__ */ z('<tr><td class="px-3 py-2"><button type="button" class="flex min-w-0 items-center gap-2 text-left hover:underline"><!> <span class="truncate"> </span></button></td><td class="text-muted-foreground px-3 py-2 text-xs"><!> <!></td><td class="px-3 py-2"><!></td><td class="max-w-72 px-3 py-2 font-mono text-xs break-all"> </td><td class="px-3 py-2 text-xs whitespace-nowrap tabular-nums"> </td><td class="px-3 py-2 text-xs whitespace-nowrap tabular-nums"> </td></tr>'), mC = /* @__PURE__ */ z('<table class="w-full border-collapse text-sm"><thead class="bg-background text-muted-foreground sticky top-0 z-10 text-left text-xs shadow-[0_1px_0_var(--border)]"><tr><!><th scope="col" class="px-3 py-2 font-medium">About</th><!><!><!><!></tr></thead><tbody></tbody></table>'), bC = /* @__PURE__ */ z('<div class="flex h-full min-h-0 min-w-0 flex-col"><div class="flex flex-wrap items-end gap-x-3 gap-y-2 border-b px-4 py-3"><div role="tablist" aria-label="Rows" class="bg-muted inline-flex rounded-lg p-0.5"></div> <label class="flex min-w-40 flex-1 flex-col gap-1 text-xs"><span class="text-muted-foreground">Contains</span> <!></label> <label class="flex flex-col gap-1 text-xs"><span class="text-muted-foreground">Type</span> <select class="border-input bg-background h-8 rounded-md border px-2 text-sm"><option>Every type</option><!></select></label> <label class="flex flex-col gap-1 text-xs"><span class="text-muted-foreground">Source</span> <select class="border-input bg-background h-8 rounded-md border px-2 text-sm"><option>Every source</option><!></select></label> <fieldset class="flex flex-col gap-1 text-xs"><legend class="text-muted-foreground mb-1">Observed between</legend> <span class="flex items-center gap-1"><input type="date" aria-label="Observed from" class="border-input bg-background h-8 rounded-md border px-2 text-sm"/> <span class="text-muted-foreground">–</span> <input type="date" aria-label="Observed to" class="border-input bg-background h-8 rounded-md border px-2 text-sm"/></span></fieldset> <label class="flex flex-col gap-1 text-xs"><span class="text-muted-foreground">Assessment</span> <select class="border-input bg-background h-8 rounded-md border px-2 text-sm"><option>Any confidence</option><option>High (80%+)</option><option>Medium (50-79%)</option><option>Low (under 50%)</option><option>Unevidenced</option></select></label> <!></div> <p class="text-muted-foreground border-b px-4 py-1.5 text-xs" aria-live="polite"> <!> <!></p> <div class="min-h-0 flex-1 overflow-auto"><!></div></div>');
function xC(e, t) {
  Ee(t, !0);
  const r = 500;
  let n = /* @__PURE__ */ he("exhibits"), o = /* @__PURE__ */ he(""), s = /* @__PURE__ */ he(""), i = /* @__PURE__ */ he(""), l = /* @__PURE__ */ he(""), c = /* @__PURE__ */ he(""), u = /* @__PURE__ */ he("any"), d = /* @__PURE__ */ he(Gt({ key: "title", down: !1 })), f = /* @__PURE__ */ he(Gt({ key: "observed", down: !0 }));
  const h = /* @__PURE__ */ T(() => ({
    types: new Set(a(s) ? [a(s)] : []),
    sources: new Set(a(i) ? [a(i)] : []),
    ...a(l) ? { from: a(l) } : {},
    ...a(c) ? { to: a(c) } : {},
    assessment: a(u),
    text: a(o)
  })), p = /* @__PURE__ */ T(() => OT(t.graph)), v = /* @__PURE__ */ T(() => um(t.graph)), g = /* @__PURE__ */ T(() => [
    ...new Set(t.graph.entities.map((ie) => ie.type))
  ].sort()), y = /* @__PURE__ */ T(() => [
    .../* @__PURE__ */ new Set([
      ...a(p).flatMap((ie) => ie.sources),
      ...a(v).flatMap((ie) => ie.source ? [ie.source] : [])
    ])
  ].sort()), _ = (ie, B) => ie === void 0 ? B === void 0 ? 0 : 1 : B === void 0 || ie < B ? -1 : ie > B ? 1 : 0, k = (ie, B) => ({
    title: ie.entity.title.toLowerCase(),
    type: ie.entity.type,
    confidence: ie.confidence,
    evidence: ie.evidenceCount,
    observed: ie.lastObserved,
    path: ie.entity.path
  })[B], S = (ie, B) => ({
    title: ie.entity.title.toLowerCase(),
    source: ie.source,
    location: ie.location || void 0,
    observed: ie.observedAt,
    event: ie.eventAt
  })[B], b = (ie, B, ne) => [...ie].sort((ge, Te) => {
    const [Ie, qe] = [ne(ge, B.key), ne(Te, B.key)];
    return Ie === void 0 || qe === void 0 ? _(Ie, qe) : B.down ? _(qe, Ie) : _(Ie, qe);
  }), $ = /* @__PURE__ */ T(() => b(NT(a(p), a(h)), a(d), k)), E = /* @__PURE__ */ T(() => b(PT(a(v), a(h)), a(f), S)), C = /* @__PURE__ */ T(() => a(n) === "exhibits" ? a($).length : a(E).length), w = /* @__PURE__ */ T(() => a(n) === "exhibits" ? a(p).length : a(v).length), O = /* @__PURE__ */ T(() => !!(a(o) || a(s) || a(i) || a(l) || a(c) || a(u) !== "any"));
  function A() {
    Z(o, ""), Z(s, ""), Z(i, ""), Z(l, ""), Z(c, ""), Z(u, "any");
  }
  const R = (ie) => t.graph.entities.find((B) => B.id === ie)?.title ?? ie;
  var W = bC(), q = M(W), P = M(q);
  Ae(P, 20, () => [["exhibits", "Exhibits"], ["observations", "Observations"]], ([ie, B]) => ie, (ie, B) => {
    var ne = /* @__PURE__ */ T(() => fr(B, 2));
    let ge = () => a(ne)[0], Te = () => a(ne)[1];
    var Ie = lC(), qe = j(Ie, !0);
    L(() => {
      $e(Ie, "aria-selected", a(n) === ge()), Ye(Ie, 1, `rounded-md px-2.5 py-1 text-xs ${a(n) === ge() ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`), N(qe, Te());
    }), ht("click", Ie, () => Z(n, ge(), !0)), x(ie, Ie);
  });
  var H = m(P, 2), V = m(M(H), 2);
  Tu(V, {
    placeholder: "id, title, path, note…",
    class: "h-8",
    get value() {
      return a(o);
    },
    set value(ie) {
      Z(o, ie, !0);
    }
  });
  var Y = m(H, 2), oe = m(M(Y), 2), X = M(oe);
  X.value = X.__value = "";
  var I = m(X);
  Ae(I, 16, () => a(g), (ie) => ie, (ie, B) => {
    var ne = Wf(), ge = j(ne, !0), Te = {};
    L(() => {
      N(ge, B), Te !== (Te = B) && (ne.value = (ne.__value = Te) ?? "");
    }), x(ie, ne);
  }), zs(oe);
  var te = m(Y, 2), F = m(M(te), 2), Q = M(F);
  Q.value = Q.__value = "";
  var pe = m(Q);
  Ae(pe, 16, () => a(y), (ie) => ie, (ie, B) => {
    var ne = Wf(), ge = j(ne, !0), Te = {};
    L(() => {
      N(ge, B), Te !== (Te = B) && (ne.value = (ne.__value = Te) ?? "");
    }), x(ie, ne);
  }), zs(F);
  var fe = m(te, 2), G = m(M(fe), 2), ve = M(G), ke = m(ve, 4), se = m(fe, 2), ye = m(M(se), 2), U = M(ye);
  U.value = U.__value = "any";
  var ee = m(U);
  ee.value = ee.__value = "high";
  var ue = m(ee);
  ue.value = ue.__value = "medium";
  var me = m(ue);
  me.value = me.__value = "low";
  var Re = m(me);
  Re.value = Re.__value = "unevidenced", zs(ye);
  var Ve = m(se, 2);
  {
    var _e = (ie) => {
      ft(ie, {
        variant: "ghost",
        size: "sm",
        onclick: A,
        children: (B, ne) => {
          var ge = ct("Clear");
          x(B, ge);
        },
        $$slots: { default: !0 }
      });
    };
    D(Ve, (ie) => {
      a(O) && ie(_e);
    });
  }
  var Le = m(q, 2), De = M(Le), ce = m(De);
  {
    var xe = (ie) => {
      var B = ct();
      B.nodeValue = "- showing the first 500; narrow the filters to see the rest", x(ie, B);
    };
    D(ce, (ie) => {
      a(C) > r && ie(xe);
    });
  }
  var Se = m(ce, 2);
  {
    var ze = (ie) => {
      var B = ct("· dates are when evidence was observed");
      x(ie, B);
    };
    D(Se, (ie) => {
      (a(l) || a(c)) && ie(ze);
    });
  }
  var de = m(Le, 2), we = M(de);
  {
    var je = (ie) => {
      var B = cC(), ne = M(B);
      {
        var ge = (Ie) => {
          var qe = ct();
          L(() => N(qe, a(n) === "exhibits" ? "No exhibits on file." : "No evidence on file: no exhibit records where it was seen.")), x(Ie, qe);
        }, Te = (Ie) => {
          var qe = ct("Nothing matches these filters.");
          x(Ie, qe);
        };
        D(ne, (Ie) => {
          a(w) === 0 ? Ie(ge) : Ie(Te, -1);
        });
      }
      x(ie, B);
    }, Fe = (ie) => {
      var B = hC(), ne = M(B), ge = M(ne), Te = M(ge);
      Cr(Te, () => "Exhibit", () => a(d).key === "title", () => a(d).down, () => () => Z(
        d,
        {
          key: "title",
          down: a(d).key === "title" && !a(d).down
        },
        !0
      ));
      var Ie = m(Te);
      Cr(Ie, () => "Type", () => a(d).key === "type", () => a(d).down, () => () => Z(
        d,
        {
          key: "type",
          down: a(d).key === "type" && !a(d).down
        },
        !0
      ));
      var qe = m(Ie, 2);
      Cr(qe, () => "Confidence", () => a(d).key === "confidence", () => a(d).down, () => () => Z(
        d,
        {
          key: "confidence",
          down: !(a(d).key === "confidence" && a(d).down)
        },
        !0
      ));
      var Je = m(qe);
      Cr(Je, () => "Evidence", () => a(d).key === "evidence", () => a(d).down, () => () => Z(
        d,
        {
          key: "evidence",
          down: !(a(d).key === "evidence" && a(d).down)
        },
        !0
      ));
      var at = m(Je);
      Cr(at, () => "Last observed", () => a(d).key === "observed", () => a(d).down, () => () => Z(
        d,
        {
          key: "observed",
          down: !(a(d).key === "observed" && a(d).down)
        },
        !0
      ));
      var Ot = m(at);
      Cr(Ot, () => "File", () => a(d).key === "path", () => a(d).down, () => () => Z(
        d,
        {
          key: "path",
          down: a(d).key === "path" && !a(d).down
        },
        !0
      ));
      var gt = m(ne);
      Ae(gt, 21, () => a($).slice(0, r), (st) => st.entity.id, (st, lt) => {
        var er = fC(), ar = M(er), Ar = M(ar), mr = M(Ar);
        vr(mr, {
          get type() {
            return a(lt).entity.type;
          },
          size: "sm"
        });
        var Er = m(mr, 2), Mr = M(Er), Ft = j(Mr, !0), An = m(Mr, 2), En = j(An, !0), Wr = m(ar), Mn = j(Wr, !0), Hr = m(Wr), to = M(Hr);
        Ae(to, 20, () => a(lt).sources, (bt) => bt, (bt, Ut) => {
          Jt(bt, {
            variant: "secondary",
            class: "font-mono text-[10px]",
            children: (br, Bt) => {
              var Tr = ct();
              L(() => N(Tr, Ut)), x(br, Tr);
            },
            $$slots: { default: !0 }
          });
        });
        var ln = m(Hr), Tn = M(ln);
        {
          var ro = (bt) => {
            var Ut = uC(), br = re(Ut), Bt = m(br), Tr = j(Bt, !0);
            L(
              (ja, gm, mm) => {
                N(br, `${ja ?? ""}% `), $e(Bt, "title", gm), N(Tr, mm);
              },
              [
                () => Math.round(a(lt).confidence * 100),
                () => a(lt).basis ? oc(a(lt).basis) : void 0,
                () => a(lt).basis === "unevidenced" ? "unevidenced" : cm(a(lt).confidence)
              ]
            ), x(bt, Ut);
          }, Cn = (bt) => {
            var Ut = dC();
            x(bt, Ut);
          };
          D(Tn, (bt) => {
            a(lt).confidence !== void 0 ? bt(ro) : bt(Cn, -1);
          });
        }
        var On = m(ln), nt = j(On, !0), Ge = m(On), Ke = j(Ge, !0), mt = m(Ge), kt = j(mt, !0);
        L(
          (bt) => {
            Ye(er, 1, `hover:bg-muted/60 border-b align-top ${a(lt).entity.id === t.selected ? "bg-accent" : ""}`), N(Ft, a(lt).entity.title), N(En, a(lt).entity.id), N(Mn, bt), N(nt, a(lt).evidenceCount), N(Ke, a(lt).lastObserved ?? "—"), $e(mt, "title", a(lt).entity.path), N(kt, a(lt).entity.path);
          },
          [() => a(lt).entity.type.replaceAll("_", " ")]
        ), ht("click", Ar, () => t.onselect(a(lt).entity.id)), x(st, er);
      }), x(ie, B);
    }, Xe = (ie) => {
      var B = mC(), ne = M(B), ge = M(ne), Te = M(ge);
      Cr(Te, () => "Exhibit", () => a(f).key === "title", () => a(f).down, () => () => Z(
        f,
        {
          key: "title",
          down: a(f).key === "title" && !a(f).down
        },
        !0
      ));
      var Ie = m(Te, 2);
      Cr(Ie, () => "Source", () => a(f).key === "source", () => a(f).down, () => () => Z(
        f,
        {
          key: "source",
          down: a(f).key === "source" && !a(f).down
        },
        !0
      ));
      var qe = m(Ie);
      Cr(qe, () => "Where", () => a(f).key === "location", () => a(f).down, () => () => Z(
        f,
        {
          key: "location",
          down: a(f).key === "location" && !a(f).down
        },
        !0
      ));
      var Je = m(qe);
      Cr(Je, () => "Observed (observedAt)", () => a(f).key === "observed", () => a(f).down, () => () => Z(
        f,
        {
          key: "observed",
          down: !(a(f).key === "observed" && a(f).down)
        },
        !0
      ));
      var at = m(Je);
      Cr(at, () => "Happened (eventAt)", () => a(f).key === "event", () => a(f).down, () => () => Z(
        f,
        {
          key: "event",
          down: !(a(f).key === "event" && a(f).down)
        },
        !0
      ));
      var Ot = m(ne);
      Ae(Ot, 21, () => a(E).slice(0, r), (gt) => gt.key, (gt, st) => {
        var lt = gC(), er = M(lt), ar = M(er), Ar = M(ar);
        vr(Ar, {
          get type() {
            return a(st).entity.type;
          },
          size: "sm"
        });
        var mr = m(Ar, 2), Er = j(mr, !0), Mr = m(er), Ft = M(Mr);
        {
          var An = (Ke) => {
            var mt = pC(), kt = M(mt), bt = j(kt, !0), Ut = m(kt);
            Gn(Ut, { class: "size-3" });
            var br = m(Ut, 1, !0);
            L(
              (Bt) => {
                N(bt, a(st).link.rel), N(br, Bt);
              },
              [() => R(a(st).link.target)]
            ), x(Ke, mt);
          }, En = (Ke) => {
            var mt = ct("the exhibit");
            x(Ke, mt);
          };
          D(Ft, (Ke) => {
            a(st).link ? Ke(An) : Ke(En, -1);
          });
        }
        var Wr = m(Ft, 2);
        {
          var Mn = (Ke) => {
            var mt = vC(), kt = j(mt, !0);
            L(() => N(kt, a(st).evidence.note)), x(Ke, mt);
          };
          D(Wr, (Ke) => {
            typeof a(st).evidence.note == "string" && Ke(Mn);
          });
        }
        var Hr = m(Mr), to = M(Hr);
        {
          var ln = (Ke) => {
            Jt(Ke, {
              variant: "outline",
              class: "font-mono text-[10px]",
              children: (mt, kt) => {
                var bt = ct();
                L(() => N(bt, a(st).source)), x(mt, bt);
              },
              $$slots: { default: !0 }
            });
          };
          D(to, (Ke) => {
            a(st).source && Ke(ln);
          });
        }
        var Tn = m(Hr), ro = j(Tn, !0), Cn = m(Tn), On = j(Cn, !0), nt = m(Cn), Ge = j(nt, !0);
        L(
          (Ke) => {
            Ye(lt, 1, `hover:bg-muted/60 border-b align-top ${a(st).entity.id === t.selected ? "bg-accent" : ""}`), N(Er, a(st).entity.title), N(ro, a(st).location || "—"), N(On, Ke), N(Ge, a(st).eventAt ?? "—");
          },
          [() => ii(a(st).observedAt) ?? "—"]
        ), ht("click", ar, () => t.onselect(a(st).entity.id)), x(gt, lt);
      }), x(ie, B);
    };
    D(we, (ie) => {
      a(C) === 0 ? ie(je) : a(n) === "exhibits" ? ie(Fe, 1) : ie(Xe, -1);
    });
  }
  L(() => N(De, `${a(C) ?? ""} of ${a(w) ?? ""} ${a(n) === "exhibits" ? a(w) === 1 ? "exhibit" : "exhibits" : a(w) === 1 ? "observation" : "observations"} `)), Pi(oe, () => a(s), (ie) => Z(s, ie)), Pi(F, () => a(i), (ie) => Z(i, ie)), Uo(ve, () => a(l), (ie) => Z(l, ie)), Uo(ke, () => a(c), (ie) => Z(c, ie)), Pi(ye, () => a(u), (ie) => Z(u, ie)), x(e, W), Me();
}
Lt(["click"]);
var yC = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "class",
  "orientation",
  "children"
]), _C = /* @__PURE__ */ z("<!> <!>", 1);
function Hf(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = be(t, "orientation", 3, "vertical"), o = /* @__PURE__ */ K(t, yC);
  var s = Ze(), i = re(s);
  {
    let l = /* @__PURE__ */ T(() => sr("data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent flex touch-none p-px transition-colors select-none", t.class));
    It(i, () => D$, (c, u) => {
      u(c, J(
        {
          "data-slot": "scroll-area-scrollbar",
          get "data-orientation"() {
            return n();
          },
          get orientation() {
            return n();
          },
          get class() {
            return a(l);
          }
        },
        () => o,
        {
          get ref() {
            return r();
          },
          set ref(d) {
            r(d);
          },
          children: (d, f) => {
            var h = _C(), p = re(h);
            vt(p, () => t.children ?? dt);
            var v = m(p, 2);
            It(v, () => Z$, (g, y) => {
              y(g, {
                "data-slot": "scroll-area-thumb",
                class: "rounded-full relative flex-1 bg-border"
              });
            }), x(d, h);
          },
          $$slots: { default: !0 }
        }
      ));
    });
  }
  x(e, s), Me();
}
var wC = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "viewportRef",
  "class",
  "orientation",
  "scrollbarXClasses",
  "scrollbarYClasses",
  "children"
]), kC = /* @__PURE__ */ z("<!> <!> <!> <!>", 1);
function Wu(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = be(t, "viewportRef", 15, null), o = be(t, "orientation", 3, "vertical"), s = be(t, "scrollbarXClasses", 3, ""), i = be(t, "scrollbarYClasses", 3, ""), l = /* @__PURE__ */ K(t, wC);
  var c = Ze(), u = re(c);
  {
    let d = /* @__PURE__ */ T(() => sr("relative", t.class));
    It(u, () => b$, (f, h) => {
      h(f, J(
        {
          "data-slot": "scroll-area",
          get class() {
            return a(d);
          }
        },
        () => l,
        {
          get ref() {
            return r();
          },
          set ref(p) {
            r(p);
          },
          children: (p, v) => {
            var g = kC(), y = re(g);
            It(y, () => w$, (E, C) => {
              C(E, {
                "data-slot": "scroll-area-viewport",
                class: "size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
                get ref() {
                  return n();
                },
                set ref(w) {
                  n(w);
                },
                children: (w, O) => {
                  var A = Ze(), R = re(A);
                  vt(R, () => t.children ?? dt), x(w, A);
                },
                $$slots: { default: !0 }
              });
            });
            var _ = m(y, 2);
            {
              var k = (E) => {
                Hf(E, {
                  orientation: "vertical",
                  get class() {
                    return i();
                  }
                });
              };
              D(_, (E) => {
                (o() === "vertical" || o() === "both") && E(k);
              });
            }
            var S = m(_, 2);
            {
              var b = (E) => {
                Hf(E, {
                  orientation: "horizontal",
                  get class() {
                    return s();
                  }
                });
              };
              D(S, (E) => {
                (o() === "horizontal" || o() === "both") && E(b);
              });
            }
            var $ = m(S, 2);
            It($, () => q$, (E, C) => {
              C(E, {});
            }), x(p, g);
          },
          $$slots: { default: !0 }
        }
      ));
    });
  }
  x(e, c), Me();
}
var SC = /* @__PURE__ */ z('<button type="button" role="tab"> </button>'), $C = /* @__PURE__ */ z('not synced - <button type="button" class="text-foreground underline underline-offset-2">sync now</button>', 1), zC = /* @__PURE__ */ z(' <button type="button" class="text-foreground underline underline-offset-2">sync now</button>', 1), AC = /* @__PURE__ */ z('<!> <div class="text-muted-foreground border-t px-4 py-3 text-xs">Search index: <!></div>', 1), EC = /* @__PURE__ */ z('<aside class="hidden min-h-0 w-64 border-r lg:block" aria-label="Index"><!></aside>'), MC = /* @__PURE__ */ z('<div class="bg-popover absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-sm"><span class="min-w-0 truncate"> </span> <!></div>'), TC = /* @__PURE__ */ z('<div class="bg-popover absolute top-3 left-3 flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-sm">Relationship <code class="font-mono"> </code> <!></div>'), CC = /* @__PURE__ */ z('<div class="bg-popover absolute top-3 left-3 flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs shadow-sm"><!></div>'), OC = /* @__PURE__ */ z('<div class="relative grid min-h-0 grid-cols-1 lg:grid-cols-[auto_1fr]"><!> <main class="relative min-h-0 min-w-0 lg:col-start-2"><!> <!></main></div>'), NC = /* @__PURE__ */ z('<div class="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]"><div class="flex items-center gap-2 border-b px-3 py-1.5"><!> <div role="tablist" aria-label="Browse view" class="bg-muted inline-flex rounded-lg p-0.5"></div> <span class="text-muted-foreground ml-auto hidden text-xs md:inline">Read from the canonical files in <code class="font-mono">.docket/</code></span></div> <!></div>');
function PC(e, t) {
  Ee(t, !0);
  const r = zr(), n = Nu(), o = /* @__PURE__ */ T(() => r.graph), s = /* @__PURE__ */ T(() => r.selected), i = [
    { id: "graph", label: "Graph" },
    { id: "table", label: "Table" },
    { id: "history", label: "History" }
  ], l = /* @__PURE__ */ T(() => r.scoped ? r.scope : null), c = /* @__PURE__ */ T(() => new Set(a(l)?.ids ?? [])), u = (C) => a(o).entities.find((w) => w.id === C.source)?.type ?? "", d = /* @__PURE__ */ T(() => {
    if (a(l)) {
      const O = new Map(a(o).entities.map((A) => [A.id, A]));
      return [...a(c)].map((A) => {
        const R = O.get(A);
        return R ? { id: A, title: R.title, type: R.type, ghost: !1 } : { id: A, title: A, type: "", ghost: !0 };
      });
    }
    const C = /* @__PURE__ */ new Set(), w = a(o).entities.filter((O) => !r.hiddenTypes.has(O.type) && !C.has(O.id) && C.add(O.id)).map((O) => ({
      id: O.id,
      title: O.title,
      type: O.type,
      ghost: !1
    }));
    if (r.showUnresolved) {
      const O = new Set(a(o).edges.filter((A) => A.dangling && !r.hiddenRels.has(A.rel) && !r.hiddenTypes.has(u(A))).map((A) => A.target));
      for (const A of [...O].sort()) w.push({ id: A, title: A, type: "", ghost: !0 });
    }
    return w;
  }), f = /* @__PURE__ */ T(() => {
    const C = new Set(a(d).map((A) => A.id)), w = /* @__PURE__ */ new Set();
    return (a(l) ? a(l).links : a(o).edges.filter((A) => !r.hiddenRels.has(A.rel))).filter((A) => C.has(A.source) && C.has(A.target)).map((A) => ({
      key: Po(A),
      source: A.source,
      target: A.target,
      rel: A.rel
    })).filter((A) => !w.has(A.key) && w.add(A.key));
  }), h = /* @__PURE__ */ T(() => {
    const C = r.pickedEdge;
    if (C) return {
      nodes: /* @__PURE__ */ new Set([C.source, C.target]),
      links: /* @__PURE__ */ new Set([Po(C)])
    };
    if (a(s)) {
      const w = a(l) ? a(f) : a(o).edges, O = new Set(w.filter((A) => A.source === a(s) || A.target === a(s)).map((A) => Po(A)));
      return { nodes: J3(w, a(s)), links: O };
    }
    return null;
  }), p = /* @__PURE__ */ T(() => a(c).size);
  var v = NC(), g = M(v), y = M(g);
  {
    var _ = (C) => {
      {
        let w = /* @__PURE__ */ T(() => r.showFilters ? "Hide the index" : "Show the index");
        ft(C, {
          variant: "ghost",
          size: "icon-sm",
          class: "hidden lg:inline-flex",
          get "aria-label"() {
            return a(w);
          },
          get "aria-pressed"() {
            return r.showFilters;
          },
          onclick: () => r.showFilters = !r.showFilters,
          children: (O, A) => {
            kT(O, {});
          },
          $$slots: { default: !0 }
        });
      }
    };
    D(y, (C) => {
      r.browseView === "graph" && C(_);
    });
  }
  var k = m(y, 2);
  Ae(k, 21, () => i, (C) => C.id, (C, w) => {
    var O = SC(), A = j(O, !0);
    L(() => {
      $e(O, "aria-selected", r.browseView === a(w).id), Ye(O, 1, `rounded-md px-3 py-1 text-sm ${r.browseView === a(w).id ? "bg-background text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`), N(A, a(w).label);
    }), ht("click", O, () => r.browseView = a(w).id), x(C, O);
  });
  var S = m(g, 2);
  {
    var b = (C) => {
      var w = OC(), O = M(w);
      {
        var A = (Y) => {
          var oe = EC(), X = M(oe);
          Wu(X, {
            class: "h-full",
            children: (I, te) => {
              var F = AC(), Q = re(F);
              TT(Q, {
                get graph() {
                  return a(o);
                },
                get hiddenTypes() {
                  return r.hiddenTypes;
                },
                get hiddenRels() {
                  return r.hiddenRels;
                },
                get showUnresolved() {
                  return r.showUnresolved;
                },
                set showUnresolved(se) {
                  r.showUnresolved = se;
                }
              });
              var pe = m(Q, 2), fe = m(M(pe));
              {
                var G = (se) => {
                  var ye = $C(), U = m(re(ye));
                  ht("click", U, () => r.syncOpen = !0), x(se, ye);
                }, ve = (se) => {
                  var ye = zC(), U = re(ye), ee = m(U);
                  L(() => N(U, `${a(o).index.behind ?? ""} ${a(o).index.behind === 1 ? "file" : "files"} behind - `)), ht("click", ee, () => r.syncOpen = !0), x(se, ye);
                }, ke = (se) => {
                  var ye = ct("up to date");
                  x(se, ye);
                };
                D(fe, (se) => {
                  a(o).index.synced ? a(o).index.behind > 0 ? se(ve, 1) : se(ke, -1) : se(G);
                });
              }
              x(I, F);
            },
            $$slots: { default: !0 }
          }), x(Y, oe);
        };
        D(O, (Y) => {
          r.showFilters && Y(A);
        });
      }
      var R = m(O, 2), W = M(R);
      {
        let Y = /* @__PURE__ */ T(() => a(l) ? "Nothing here to show." : void 0);
        lm(W, {
          get nodes() {
            return a(d);
          },
          get links() {
            return a(f);
          },
          get colourOf() {
            return n.colour;
          },
          get iconOf() {
            return n.icon;
          },
          get selected() {
            return a(s);
          },
          get emphasis() {
            return a(h);
          },
          get focus() {
            return r.focus;
          },
          get emptyHint() {
            return a(Y);
          },
          onselect: (oe) => r.select(oe)
        });
      }
      var q = m(W, 2);
      {
        var P = (Y) => {
          var oe = MC(), X = M(oe), I = j(X), te = m(X, 2);
          ft(te, {
            variant: "outline",
            size: "xs",
            onclick: () => r.showEverything(),
            children: (F, Q) => {
              var pe = ct("Show all exhibits");
              x(F, pe);
            },
            $$slots: { default: !0 }
          }), L(() => N(I, `Showing ${a(p) === 1 ? "the 1 exhibit" : `the ${a(p)} exhibits`}: ${r.scope?.label ?? ""}`)), x(Y, oe);
        }, H = (Y) => {
          var oe = TC(), X = m(M(oe)), I = j(X, !0), te = m(X, 2);
          ft(te, {
            variant: "ghost",
            size: "icon-xs",
            "aria-label": "Clear",
            onclick: () => r.pickedEdge = null,
            children: (F, Q) => {
              Xs(F, {});
            },
            $$slots: { default: !0 }
          }), L(() => N(I, r.pickedEdge.rel)), x(Y, oe);
        }, V = (Y) => {
          var oe = CC(), X = M(oe);
          ft(X, {
            variant: "outline",
            size: "xs",
            onclick: () => r.scope && r.showScope(r.scope),
            children: (I, te) => {
              var F = ct();
              L(() => N(F, `Show only ${r.scope.label ?? ""}`)), x(I, F);
            },
            $$slots: { default: !0 }
          }), x(Y, oe);
        };
        D(q, (Y) => {
          a(l) ? Y(P) : r.pickedEdge ? Y(H, 1) : r.scope && Y(V, 2);
        });
      }
      x(C, w);
    }, $ = (C) => {
      xC(C, {
        get graph() {
          return a(o);
        },
        onselect: (w) => r.select(w),
        get selected() {
          return a(s);
        }
      });
    }, E = (C) => {
      rC(C, {
        get graph() {
          return a(o);
        },
        onselect: (w) => r.select(w),
        get selected() {
          return a(s);
        }
      });
    };
    D(S, (C) => {
      r.browseView === "graph" ? C(b) : r.browseView === "table" ? C($, 1) : C(E, -1);
    });
  }
  x(e, v), Me();
}
Lt(["click"]);
var IC = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function pm(e, t) {
  let r = /* @__PURE__ */ K(t, IC);
  const n = {
    name: "folder-sync",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v.5"
        }
      ],
      ["path", { d: "M12 10v4h4" }],
      ["path", { d: "m12 14 1.535-1.605a5 5 0 0 1 8 1.5" }],
      ["path", { d: "M22 22v-4h-4" }],
      ["path", { d: "m22 18-1.535 1.605a5 5 0 0 1-8-1.5" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var RC = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function DC(e, t) {
  let r = /* @__PURE__ */ K(t, RC);
  const n = {
    name: "moon",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var LC = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function jC(e, t) {
  let r = /* @__PURE__ */ K(t, LC);
  const n = {
    name: "panel-right",
    size: 24,
    node: [
      [
        "rect",
        { width: "18", height: "18", x: "3", y: "3", rx: "2" }
      ],
      ["path", { d: "M15 3v18" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var VC = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function qf(e, t) {
  let r = /* @__PURE__ */ K(t, VC);
  const n = {
    name: "panel-right-close",
    size: 24,
    node: [
      [
        "rect",
        { width: "18", height: "18", x: "3", y: "3", rx: "2" }
      ],
      ["path", { d: "M15 3v18" }],
      ["path", { d: "m8 9 3 3-3 3" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var FC = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function ZC(e, t) {
  let r = /* @__PURE__ */ K(t, FC);
  const n = {
    name: "sun",
    size: 24,
    node: [
      ["circle", { cx: "12", cy: "12", r: "4" }],
      ["path", { d: "M12 2v2" }],
      ["path", { d: "M12 20v2" }],
      ["path", { d: "m4.93 4.93 1.41 1.41" }],
      ["path", { d: "m17.66 17.66 1.41 1.41" }],
      ["path", { d: "M2 12h2" }],
      ["path", { d: "M20 12h2" }],
      ["path", { d: "m6.34 17.66-1.41 1.41" }],
      ["path", { d: "m19.07 4.93-1.41 1.41" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var UC = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function BC(e, t) {
  let r = /* @__PURE__ */ K(t, UC);
  const n = {
    name: "send-horizontal",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"
        }
      ],
      ["path", { d: "M6 12h16" }]
    ],
    aliases: ["send-horizonal"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var WC = /* @__PURE__ */ z(`<div class="text-muted-foreground flex flex-col gap-2 text-sm"><p class="text-foreground font-serif text-lg">Examine the casebook</p> <p>Put a question. <code class="font-mono">docket search</code> finds the exhibits, a model summarizes them citing
            each one, and the board shows only the exhibits cited.</p> <p class="text-xs">Answers are kept in <code class="font-mono">.docket/.cache/</code>: asking again returns the same answer until the
            question, one of its exhibits or the relationship paths connecting them change.</p></div>`), HC = /* @__PURE__ */ z('<div class="border-destructive/40 text-destructive flex gap-2 rounded-md border p-3 text-sm"><!> <span class="break-words"> </span></div>'), qC = /* @__PURE__ */ z('<p class="text-muted-foreground flex items-center gap-2 font-serif text-sm italic"><!> Consulting the casebook…</p>'), GC = /* @__PURE__ */ z("<!> from the cache", 1), KC = /* @__PURE__ */ z('<!> <p class="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">Summarized by <code class="font-mono"> </code> <!></p>', 1), YC = /* @__PURE__ */ z('<div><!> <div class="min-w-0 flex-1"><!></div></div>'), XC = /* @__PURE__ */ z(`<p class="text-muted-foreground text-xs">The search index is behind the files; run <code class="font-mono">docket sync</code> and ask again to search
                    everything.</p>`), JC = /* @__PURE__ */ z('<li><button type="button" class="hover:bg-muted flex max-w-64 items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs"><!> <span class="truncate"> </span></button></li>'), QC = /* @__PURE__ */ z("<!> Show these on the board", 1), eO = /* @__PURE__ */ z('<section class="flex flex-col gap-1.5"><h3 class="section-title text-sm"> </h3> <ul class="flex flex-wrap gap-1.5"></ul> <!></section>'), tO = /* @__PURE__ */ z("<!> <!> <!>", 1), rO = /* @__PURE__ */ z('<article class="flex flex-col gap-3"><div class="flex gap-2.5"><span class="text-gilt w-4 shrink-0 font-serif font-semibold">Q.</span> <p class="min-w-0 font-serif break-words italic"> </p></div> <div class="flex gap-2.5"><span class="text-gilt w-4 shrink-0 font-serif font-semibold">A.</span> <div class="flex min-w-0 flex-1 flex-col gap-3"><!></div></div></article>'), nO = /* @__PURE__ */ z('<div class="flex flex-col gap-5 p-4"><!> <!> <div></div></div>'), oO = /* @__PURE__ */ z('<div class="flex h-full min-h-0 flex-col"><!> <form class="flex gap-2 border-t p-3"><label for="chat" class="sr-only">Question for the casebook</label> <!> <!></form></div>');
function sO(e, t) {
  Ee(t, !0);
  let r = be(t, "turns", 15);
  const n = zr();
  let o = /* @__PURE__ */ he(""), s = /* @__PURE__ */ he(null);
  const i = /* @__PURE__ */ T(() => r().some((_) => _.reply === null && _.error === null)), l = /* @__PURE__ */ T(() => new Map(t.graph.entities.map((_) => [_.id, _]))), c = (_) => a(l).get(_)?.title, u = (_) => {
    const k = new Map(_.answer.documents.map((b) => [b.id, b]));
    return (_.summary?.cited.length ? _.summary.cited : [
      .../* @__PURE__ */ new Set([
        ..._.answer.sources.flatMap((b) => b.hits.map(($) => $.id)),
        ..._.answer.documents.map((b) => b.id)
      ])
    ]).flatMap((b) => {
      const $ = k.get(b);
      return $ ? [$] : [];
    });
  }, d = (_) => {
    const k = new Date(_);
    return Number.isNaN(k.getTime()) ? _ : k.toLocaleString(void 0, { dateStyle: "medium", timeStyle: "short" });
  };
  async function f(_) {
    _.preventDefault();
    const k = a(o).trim();
    if (!k || a(i)) return;
    Z(o, "");
    const S = r().length;
    r([...r(), { question: k, reply: null, error: null }]), await Yi(), a(s)?.scrollIntoView({ block: "end" });
    let b;
    try {
      const $ = await n.api.fetch(`/api/chat?q=${encodeURIComponent(k)}`), E = await $.json();
      if (!$.ok || "error" in E) throw new Error("error" in E ? E.error : $.statusText);
      b = { question: k, reply: E, error: null }, t.onshow(wf(E));
    } catch ($) {
      b = {
        question: k,
        reply: null,
        error: $ instanceof Error ? $.message : String($)
      };
    }
    r(r().map(($, E) => E === S ? b : $)), await Yi(), a(s)?.scrollIntoView({ block: "end" });
  }
  var h = oO(), p = M(h);
  Wu(p, {
    class: "min-h-0 flex-1",
    children: (_, k) => {
      var S = nO(), b = M(S);
      {
        var $ = (w) => {
          var O = WC();
          x(w, O);
        };
        D(b, (w) => {
          r().length === 0 && w($);
        });
      }
      var E = m(b, 2);
      Ae(E, 17, r, xt, (w, O) => {
        var A = rO(), R = M(A), W = m(M(R), 2), q = j(W, !0), P = m(R, 2), H = m(M(P), 2), V = M(H);
        {
          var Y = (I) => {
            var te = HC(), F = M(te);
            or(F, { class: "mt-0.5 size-4 shrink-0" });
            var Q = m(F, 2), pe = j(Q, !0);
            L(() => N(pe, a(O).error)), x(I, te);
          }, oe = (I) => {
            var te = qC(), F = M(te);
            Bn(F, { class: "size-4 animate-spin" }), x(I, te);
          }, X = (I) => {
            const te = /* @__PURE__ */ T(() => a(O).reply), F = /* @__PURE__ */ T(() => u(a(te)));
            var Q = tO(), pe = re(Q);
            {
              var fe = (U) => {
                var ee = KC(), ue = re(ee);
                {
                  let De = /* @__PURE__ */ T(() => Pg(a(te).summary.text, new Set(a(te).summary.cited)));
                  Fs(ue, {
                    get content() {
                      return a(De);
                    },
                    titleOf: c,
                    get onselect() {
                      return t.onselect;
                    }
                  });
                }
                var me = m(ue, 2), Re = m(M(me)), Ve = j(Re, !0), _e = m(Re, 2);
                {
                  var Le = (De) => {
                    {
                      let ce = /* @__PURE__ */ T(() => d(a(te).summary.createdAt));
                      Jt(De, {
                        variant: "outline",
                        class: "gap-1 text-[10px]",
                        get title() {
                          return `Written ${a(ce) ?? ""}`;
                        },
                        children: (xe, Se) => {
                          var ze = GC(), de = re(ze);
                          Bu(de, { class: "size-3" }), x(xe, ze);
                        },
                        $$slots: { default: !0 }
                      });
                    }
                  };
                  D(_e, (De) => {
                    a(te).summary.cached && De(Le);
                  });
                }
                L(() => N(Ve, a(te).summary.model)), x(U, ee);
              }, G = (U) => {
                var ee = YC(), ue = M(ee);
                {
                  let Ve = /* @__PURE__ */ T(() => a(te).notice.reason === "failed" ? "text-destructive" : "text-amber-600 dark:text-amber-400");
                  or(ue, {
                    get class() {
                      return `mt-0.5 size-4 shrink-0 ${a(Ve) ?? ""}`;
                    }
                  });
                }
                var me = m(ue, 2), Re = M(me);
                Fs(Re, {
                  get content() {
                    return a(te).notice.message;
                  },
                  titleOf: c,
                  get onselect() {
                    return t.onselect;
                  }
                }), L(() => Ye(ee, 1, `flex gap-2 rounded-md border p-3 text-xs ${a(te).notice.reason === "failed" ? "border-destructive/40" : "border-amber-500/40 bg-amber-500/10"}`)), x(U, ee);
              };
              D(pe, (U) => {
                a(te).summary ? U(fe) : a(te).notice && U(G, 1);
              });
            }
            var ve = m(pe, 2);
            {
              var ke = (U) => {
                var ee = XC();
                x(U, ee);
              };
              D(ve, (U) => {
                (!a(te).answer.index.synced || a(te).answer.index.behind > 0) && U(ke);
              });
            }
            var se = m(ve, 2);
            {
              var ye = (U) => {
                var ee = eO(), ue = M(ee), me = j(ue), Re = m(ue, 2);
                Ae(Re, 21, () => a(F), (_e) => _e.id, (_e, Le) => {
                  var De = JC(), ce = M(De), xe = M(ce);
                  vr(xe, {
                    get type() {
                      return a(Le).type;
                    },
                    size: "sm"
                  });
                  var Se = m(xe, 2), ze = j(Se, !0);
                  L(() => {
                    $e(ce, "title", a(Le).id), N(ze, a(Le).title);
                  }), ht("click", ce, () => t.onselect(a(Le).id)), x(_e, De);
                });
                var Ve = m(Re, 2);
                ft(Ve, {
                  variant: "ghost",
                  size: "xs",
                  class: "self-start",
                  onclick: () => t.onshow(wf(a(te)), { reveal: !0 }),
                  children: (_e, Le) => {
                    var De = QC(), ce = re(De);
                    Ys(ce, {}), x(_e, De);
                  },
                  $$slots: { default: !0 }
                }), L(() => N(me, `${a(te).summary?.cited.length ? "Exhibits cited" : "Exhibits found"} (${a(F).length ?? ""})`)), x(U, ee);
              };
              D(se, (U) => {
                a(F).length > 0 && U(ye);
              });
            }
            x(I, Q);
          };
          D(V, (I) => {
            a(O).error ? I(Y) : a(O).reply ? I(X, -1) : I(oe, 1);
          });
        }
        L(() => N(q, a(O).question)), x(w, A);
      });
      var C = m(E, 2);
      _n(C, (w) => Z(s, w), () => a(s)), x(_, S);
    },
    $$slots: { default: !0 }
  });
  var v = m(p, 2), g = m(M(v), 2);
  Tu(g, {
    id: "chat",
    placeholder: "What does checkout depend on?",
    autocomplete: "off",
    get value() {
      return a(o);
    },
    set value(_) {
      Z(o, _, !0);
    }
  });
  var y = m(g, 2);
  {
    let _ = /* @__PURE__ */ T(() => a(i) || a(o).trim() === "");
    ft(y, {
      type: "submit",
      get disabled() {
        return a(_);
      },
      "aria-label": "Ask",
      children: (k, S) => {
        var b = Ze(), $ = re(b);
        {
          var E = (w) => {
            Bn(w, { class: "animate-spin" });
          }, C = (w) => {
            BC(w, {});
          };
          D($, (w) => {
            a(i) ? w(E) : w(C, -1);
          });
        }
        x(k, b);
      },
      $$slots: { default: !0 }
    });
  }
  jn("submit", v, f), x(e, h), Me();
}
Lt(["click"]);
var iO = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Hu(e, t) {
  let r = /* @__PURE__ */ K(t, iO);
  const n = {
    name: "file-text",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
        }
      ],
      ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
      ["path", { d: "M10 9H8" }],
      ["path", { d: "M16 13H8" }],
      ["path", { d: "M16 17H8" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var aO = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "class",
  "data-slot"
]);
function vm(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = be(t, "data-slot", 3, "separator"), o = /* @__PURE__ */ K(t, aO);
  var s = Ze(), i = re(s);
  {
    let l = /* @__PURE__ */ T(() => sr("shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch", t.class));
    It(i, () => l$, (c, u) => {
      u(c, J(
        {
          get "data-slot"() {
            return n();
          },
          get class() {
            return a(l);
          }
        },
        () => o,
        {
          get ref() {
            return r();
          },
          set ref(d) {
            r(d);
          }
        }
      ));
    });
  }
  x(e, s), Me();
}
var lO = /* @__PURE__ */ z('<p class="font-serif text-lg leading-snug break-words"> </p>'), cO = /* @__PURE__ */ z('<blockquote class="border-gilt border-l-2 pl-3 font-serif text-lg leading-snug break-words whitespace-pre-wrap"> </blockquote>'), uO = /* @__PURE__ */ z('<p class="text-muted-foreground text-sm">The adapter gave no canonical reference, so this cannot be checked against the files.</p>'), dO = /* @__PURE__ */ z('<span class="flex items-center gap-1.5 pl-5"><!> <span class="font-mono break-all"> </span></span>'), Gf = /* @__PURE__ */ z('<span class="text-muted-foreground pl-5"> </span>'), fO = /* @__PURE__ */ z('<span class="text-muted-foreground">Cut short; open the exhibit for the rest.</span>'), hO = /* @__PURE__ */ z('<div class="ml-5 flex flex-col gap-1"><span class="text-muted-foreground"> </span> <pre class="bg-background max-h-48 overflow-y-auto rounded border p-2 font-mono text-[11px] whitespace-pre-wrap"> </pre> <!></div>'), pO = /* @__PURE__ */ z('<button type="button" class="hover:bg-muted ml-4 flex items-center gap-1.5 self-start rounded px-1 py-0.5"><!> <span class="underline-offset-2 hover:underline"> </span></button>'), vO = /* @__PURE__ */ z('<span class="text-muted-foreground pl-5">Not in the loaded casebook.</span>'), gO = /* @__PURE__ */ z('<li class="bg-muted/50 flex flex-col gap-1 rounded-md border px-2.5 py-2 text-xs"><span class="flex items-center gap-1.5"><!> <!> <code class="min-w-0 font-mono break-all"> </code></span> <!> <!> <!> <!> <!></li>'), mO = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs"> </p>'), bO = /* @__PURE__ */ z('<ul class="flex flex-col gap-1.5"></ul> <!>', 1), xO = /* @__PURE__ */ z('<dt class="text-muted-foreground">Native id</dt> <dd class="font-mono text-xs break-all"> </dd>', 1), yO = /* @__PURE__ */ z(', model <code class="font-mono text-xs"> </code>', 1), _O = /* @__PURE__ */ z('derived by <code class="font-mono text-xs"> </code><!>', 1), wO = /* @__PURE__ */ z('<dt class="text-muted-foreground">Happened <span class="font-mono text-[10px]">eventAt</span></dt> <dd class="tabular-nums"> </dd>', 1), kO = /* @__PURE__ */ z('<dt class="text-muted-foreground">Observed <span class="font-mono text-[10px]">observedAt</span></dt> <dd class="tabular-nums"> </dd>', 1), SO = /* @__PURE__ */ z('<dt class="text-muted-foreground">Score</dt> <dd><span class="tabular-nums"> </span> <span class="text-muted-foreground text-xs"> </span></dd>', 1), $O = /* @__PURE__ */ z('<dt class="text-muted-foreground">Used in</dt> <dd class="text-xs"> </dd>', 1), zO = /* @__PURE__ */ z('<p class="text-sm"> </p>'), AO = /* @__PURE__ */ z("<li> </li>"), EO = /* @__PURE__ */ z('<ul class="text-muted-foreground flex list-disc flex-col gap-0.5 pl-4 text-xs"></ul>'), MO = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs">From <span class="tabular-nums"> </span> to <span class="tabular-nums"> </span></p>'), TO = /* @__PURE__ */ z('<pre class="bg-muted overflow-x-auto rounded p-2 font-mono text-[11px] whitespace-pre-wrap"> </pre>'), CO = /* @__PURE__ */ z(', at checkpoint <code class="font-mono"> </code>', 1), OO = /* @__PURE__ */ z('<div class="flex flex-col gap-5 p-4"><header class="flex flex-col gap-2"><div class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm"><span> </span> <!></div> <!> <p class="text-muted-foreground text-xs"> </p></header> <section class="flex flex-col gap-2"><h3 class="section-title">Canonical location</h3> <!></section> <section class="flex flex-col gap-2"><h3 class="section-title">Record</h3> <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm"><dt class="text-muted-foreground">Adapter</dt> <dd class="font-mono text-xs"> </dd> <!> <dt class="text-muted-foreground">Derivation</dt> <dd><!></dd> <!> <!> <!> <!></dl></section> <!> <section class="flex flex-col gap-2"><h3 class="section-title"> </h3> <!> <!> <!> <!> <p class="text-muted-foreground text-xs"> <code class="font-mono"> </code><!>.</p></section></div>');
function NO(e, t) {
  Ee(t, !0);
  const r = zr(), n = /* @__PURE__ */ T(() => xg(t.graph)), o = /* @__PURE__ */ T(() => new Map(t.graph.entities.map((B) => [B.id, B]))), s = /* @__PURE__ */ T(() => new Map(t.graph.entities.flatMap((B) => B.paths.map((ne) => [ne, B])))), i = /* @__PURE__ */ T(() => t.result.references?.[t.evidence.id]), l = /* @__PURE__ */ T(() => Ou(t.evidence, a(n), a(i))), c = {
    resolved: "On record at this revision.",
    stale: "The files hold a newer revision: this came from an index behind them.",
    unresolved: "The files do not hold this record in scope."
  };
  let u = /* @__PURE__ */ he(null);
  _t(() => {
    const B = t.evidence.canonicalRefs, ne = new AbortController();
    return Z(u, null), r.client.resolveEvidence(B, ne.signal).then((ge) => {
      ne.signal.aborted || Z(u, ge);
    }).catch(() => {
    }), () => ne.abort();
  });
  const d = /* @__PURE__ */ T(() => t.result.answer.interpretation), f = /* @__PURE__ */ T(() => t.result.answer.coverage), h = /* @__PURE__ */ T(() => t.result.blocks.filter((B) => {
    if (B.block.evidenceIds.includes(t.evidence.id)) return !0;
    if (!B.known) return !1;
    const ne = B.block;
    return ne.kind === "table" ? ne.rows.some((ge) => ge.evidenceIds?.includes(t.evidence.id)) : ne.kind === "graph" ? ne.edges.some((ge) => ge.evidenceIds?.includes(t.evidence.id)) : ne.kind === "timeline" ? ne.events.some((ge) => ge.evidenceIds?.includes(t.evidence.id)) : !1;
  }));
  var p = OO(), v = M(p), g = M(v), y = M(g), _ = j(y), k = m(y, 2);
  Mg(k, {
    get standing() {
      return a(l);
    }
  });
  var S = m(g, 2);
  {
    var b = (B) => {
      var ne = lO(), ge = j(ne, !0);
      L(() => N(ge, t.evidence.text)), x(B, ne);
    }, $ = /* @__PURE__ */ T(() => yg(t.evidence)), E = (B) => {
      var ne = cO(), ge = j(ne, !0);
      L(() => N(ge, t.evidence.text)), x(B, ne);
    };
    D(S, (B) => {
      a($) ? B(b) : B(E, -1);
    });
  }
  var C = m(S, 2), w = j(C, !0), O = m(v, 2), A = m(M(O), 2);
  {
    var R = (B) => {
      var ne = uO();
      x(B, ne);
    }, W = (B) => {
      var ne = bO(), ge = re(ne);
      Ae(ge, 21, () => t.evidence.canonicalRefs, xt, (qe, Je, at) => {
        const Ot = /* @__PURE__ */ T(() => _g(t.evidence, at, a(n), a(i))), gt = /* @__PURE__ */ T(() => a(u)?.state === "ready" ? a(u).references[at] : void 0), st = /* @__PURE__ */ T(() => a(Je).kind === "entity" ? a(o).get(a(Je).id) : a(Je).span ? a(s).get(a(Je).span.path) : void 0);
        var lt = gO(), er = M(lt), ar = M(er);
        {
          var Ar = (nt) => {
            iu(nt, { class: "size-3.5 text-emerald-600", "aria-label": "resolves" });
          }, mr = (nt) => {
            Xs(nt, {
              class: "text-muted-foreground size-3.5",
              "aria-label": "does not resolve"
            });
          };
          D(ar, (nt) => {
            a(Ot) ? nt(Ar) : nt(mr, -1);
          });
        }
        var Er = m(ar, 2);
        Jt(Er, {
          variant: "outline",
          class: "font-mono text-[10px]",
          children: (nt, Ge) => {
            var Ke = ct();
            L(() => N(Ke, a(Je).kind)), x(nt, Ke);
          },
          $$slots: { default: !0 }
        });
        var Mr = m(Er, 2), Ft = j(Mr, !0), An = m(er, 2);
        {
          var En = (nt) => {
            var Ge = dO(), Ke = M(Ge);
            Hu(Ke, { class: "size-3 shrink-0" });
            var mt = m(Ke, 2), kt = j(mt, !0);
            L((bt) => N(kt, bt), [() => tc(a(Je))]), x(nt, Ge);
          };
          D(An, (nt) => {
            (a(Je).span || a(Je).revision) && nt(En);
          });
        }
        var Wr = m(An, 2);
        {
          var Mn = (nt) => {
            var Ge = Gf(), Ke = j(Ge);
            L(() => N(Ke, `Lines refer to revision ${a(Je).revision ?? ""}.`)), x(nt, Ge);
          };
          D(Wr, (nt) => {
            a(Je).span?.startLine !== void 0 && nt(Mn);
          });
        }
        var Hr = m(Wr, 2);
        {
          var to = (nt) => {
            var Ge = Gf(), Ke = j(Ge, !0);
            L(() => N(Ke, c[a(i)[at]])), x(nt, Ge);
          };
          D(Hr, (nt) => {
            a(i)?.[at] && nt(to);
          });
        }
        var ln = m(Hr, 2);
        {
          var Tn = (nt) => {
            var Ge = hO(), Ke = M(Ge), mt = j(Ke), kt = m(Ke, 2), bt = j(kt, !0), Ut = m(kt, 2);
            {
              var br = (Bt) => {
                var Tr = fO();
                x(Bt, Tr);
              };
              D(Ut, (Bt) => {
                a(gt).excerpt.truncated && Bt(br);
              });
            }
            L(() => {
              N(mt, `The files ${a(gt).status === "stale" ? "now say" : "say"}${a(gt).excerpt.path ? `, ${a(gt).excerpt.path}${a(gt).excerpt.startLine !== void 0 ? `:${a(gt).excerpt.startLine}${a(gt).excerpt.endLine !== void 0 && a(gt).excerpt.endLine !== a(gt).excerpt.startLine ? `-${a(gt).excerpt.endLine}` : ""}` : ""}` : ""}${a(gt).record ? ` @ ${a(gt).record.revision}` : ""}:`), N(bt, a(gt).excerpt.text);
            }), x(nt, Ge);
          };
          D(ln, (nt) => {
            a(gt)?.excerpt && nt(Tn);
          });
        }
        var ro = m(ln, 2);
        {
          var Cn = (nt) => {
            var Ge = pO(), Ke = M(Ge);
            vr(Ke, {
              get type() {
                return a(st).type;
              },
              size: "sm"
            });
            var mt = m(Ke, 2), kt = j(mt);
            L(() => N(kt, `Open the exhibit: ${a(st).title ?? ""}`)), ht("click", Ge, () => r.select(a(st).id)), x(nt, Ge);
          }, On = (nt) => {
            var Ge = vO();
            x(nt, Ge);
          };
          D(ro, (nt) => {
            a(st) ? nt(Cn) : a(Ot) || nt(On, 1);
          });
        }
        L(() => N(Ft, a(Je).id)), x(qe, lt);
      });
      var Te = m(ge, 2);
      {
        var Ie = (qe) => {
          var Je = mO(), at = j(Je);
          L(() => N(at, `Could not read the files at these references: ${a(u).message ?? ""}`)), x(qe, Je);
        };
        D(Te, (qe) => {
          a(u)?.state === "failed" && qe(Ie);
        });
      }
      x(B, ne);
    };
    D(A, (B) => {
      t.evidence.canonicalRefs.length === 0 ? B(R) : B(W, -1);
    });
  }
  var q = m(O, 2), P = m(M(q), 2), H = m(M(P), 2), V = j(H, !0), Y = m(H, 2);
  {
    var oe = (B) => {
      var ne = xO(), ge = m(re(ne), 2), Te = j(ge, !0);
      L(() => N(Te, t.evidence.nativeId)), x(B, ne);
    };
    D(Y, (B) => {
      t.evidence.nativeId && B(oe);
    });
  }
  var X = m(Y, 4), I = M(X);
  {
    var te = (B) => {
      var ne = _O(), ge = m(re(ne)), Te = j(ge, !0), Ie = m(ge);
      {
        var qe = (Je) => {
          var at = yO(), Ot = m(re(at)), gt = j(Ot, !0);
          L(() => N(gt, t.evidence.derivation.model)), x(Je, at);
        };
        D(Ie, (Je) => {
          t.evidence.derivation.model && Je(qe);
        });
      }
      L(() => N(Te, t.evidence.derivation.engine)), x(B, ne);
    }, F = (B) => {
      var ne = ct("derived; the adapter does not say how");
      x(B, ne);
    }, Q = (B) => {
      var ne = ct("retrieved as recorded, not derived");
      x(B, ne);
    };
    D(I, (B) => {
      t.evidence.derivation ? B(te) : t.evidence.kind === "derived-fact" ? B(F, 1) : B(Q, -1);
    });
  }
  var pe = m(X, 2);
  {
    var fe = (B) => {
      var ne = wO(), ge = m(re(ne), 2), Te = j(ge, !0);
      L(() => N(Te, t.evidence.eventAt)), x(B, ne);
    };
    D(pe, (B) => {
      t.evidence.eventAt && B(fe);
    });
  }
  var G = m(pe, 2);
  {
    var ve = (B) => {
      var ne = kO(), ge = m(re(ne), 2), Te = j(ge, !0);
      L(() => N(Te, t.evidence.observedAt)), x(B, ne);
    };
    D(G, (B) => {
      t.evidence.observedAt && B(ve);
    });
  }
  var ke = m(G, 2);
  {
    var se = (B) => {
      var ne = SO(), ge = m(re(ne), 2), Te = M(ge), Ie = j(Te, !0), qe = m(Te, 2), Je = j(qe);
      L(() => {
        N(Ie, t.evidence.score), N(Je, `- ${t.result.adapter ?? ""}'s own scale; not comparable with other adapters`);
      }), x(B, ne);
    };
    D(ke, (B) => {
      t.evidence.score !== void 0 && B(se);
    });
  }
  var ye = m(ke, 2);
  {
    var U = (B) => {
      var ne = $O(), ge = m(re(ne), 2), Te = j(ge, !0);
      L((Ie) => N(Te, Ie), [
        () => a(h).map(({ block: Ie }) => Ie.title ?? Ie.kind).join(", ")
      ]), x(B, ne);
    };
    D(ye, (B) => {
      a(h).length > 0 && B(U);
    });
  }
  var ee = m(q, 2);
  vm(ee, {});
  var ue = m(ee, 2), me = M(ue), Re = j(me), Ve = m(me, 2);
  {
    var _e = (B) => {
      var ne = zO(), ge = j(ne, !0);
      L(() => N(ge, a(d).description)), x(B, ne);
    };
    D(Ve, (B) => {
      a(d).description && B(_e);
    });
  }
  var Le = m(Ve, 2);
  {
    var De = (B) => {
      var ne = EO();
      Ae(ne, 21, () => a(d).assumptions, xt, (ge, Te) => {
        var Ie = AO(), qe = j(Ie, !0);
        L(() => N(qe, a(Te))), x(ge, Ie);
      }), x(B, ne);
    };
    D(Le, (B) => {
      a(d).assumptions.length > 0 && B(De);
    });
  }
  var ce = m(Le, 2);
  {
    var xe = (B) => {
      var ne = MO(), ge = m(M(ne)), Te = j(ge, !0), Ie = m(ge, 2), qe = j(Ie, !0);
      L(() => {
        N(Te, a(d).timeRange.from), N(qe, a(d).timeRange.to);
      }), x(B, ne);
    };
    D(ce, (B) => {
      a(d).timeRange && B(xe);
    });
  }
  var Se = m(ce, 2);
  {
    var ze = (B) => {
      var ne = TO(), ge = j(ne, !0);
      L(() => N(ge, a(d).nativeQuery)), x(B, ne);
    };
    D(Se, (B) => {
      a(d).nativeQuery && B(ze);
    });
  }
  var de = m(Se, 2), we = M(de), je = m(we), Fe = j(je, !0), Xe = m(je);
  {
    var ie = (B) => {
      var ne = CO(), ge = m(re(ne)), Te = j(ge, !0);
      L(() => N(Te, a(f).checkpoint)), x(B, ne);
    };
    D(Xe, (B) => {
      a(f).checkpoint && B(ie);
    });
  }
  L(
    (B, ne) => {
      N(_, `Evidence ${B ?? ""}, ${ne ?? ""}`), N(w, wg[a(l)]), N(V, t.result.adapter), N(Re, `How ${t.result.adapter ?? ""} read the question`), N(we, `Coverage: ${a(f).mode === "exhaustive" ? "every matching record" : a(f).mode === "top-k" ? "top matches only" : "unknown"}${a(f).truncated ? ", truncated" : ""} in scope `), N(Fe, a(f).scope);
    },
    [
      () => Pu(t.result, t.evidence.id),
      () => t.evidence.kind.replace("-", " ")
    ]
  ), x(e, p), Me();
}
Lt(["click"]);
var PO = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function IO(e, t) {
  let r = /* @__PURE__ */ K(t, PO);
  const n = {
    name: "copy",
    size: 24,
    node: [
      [
        "rect",
        {
          width: "14",
          height: "14",
          x: "8",
          y: "8",
          rx: "2",
          ry: "2"
        }
      ],
      [
        "path",
        {
          d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var RO = /* @__PURE__ */ z('<span class="text-muted-foreground">—</span>'), DO = /* @__PURE__ */ z('<a class="break-all underline underline-offset-2" target="_blank" rel="noreferrer"> </a>'), Kf = /* @__PURE__ */ z('<span class="break-words"> </span>'), LO = /* @__PURE__ */ z("<li><!></li>"), jO = /* @__PURE__ */ z('<ul class="flex flex-col gap-1"></ul>'), VO = /* @__PURE__ */ z('<span class="font-mono text-xs"> </span>'), FO = /* @__PURE__ */ z('<dt class="text-muted-foreground"> </dt> <dd class="min-w-0"><!></dd>', 1), ZO = /* @__PURE__ */ z('<dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs"></dl>');
function pn(e, t) {
  Ee(t, !0);
  let r = be(t, "inline", 3, !1);
  const n = (v) => String(v).replace(/^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/, "$1");
  var o = Ze(), s = re(o);
  {
    var i = (v) => {
      var g = RO();
      x(v, g);
    }, l = (v) => {
      var g = DO(), y = j(g, !0);
      L(() => {
        $e(g, "href", t.value), N(y, t.value);
      }), x(v, g);
    }, c = /* @__PURE__ */ T(() => Ng(t.value)), u = (v) => {
      var g = Kf(), y = j(g, !0);
      L((_) => N(y, _), [() => n(t.value)]), x(v, g);
    }, d = (v) => {
      var g = Ze(), y = re(g);
      {
        var _ = (b) => {
          var $ = Kf(), E = j($, !0);
          L((C) => N(E, C), [
            () => t.value.map((C) => typeof C == "object" ? JSON.stringify(C) : String(C)).join(", ")
          ]), x(b, $);
        }, k = /* @__PURE__ */ T(() => r() || t.value.every((b) => typeof b != "object" || b === null)), S = (b) => {
          var $ = jO();
          Ae($, 21, () => t.value, xt, (E, C) => {
            var w = LO(), O = M(w);
            pn(O, {
              get value() {
                return a(C);
              }
            }), x(E, w);
          }), x(b, $);
        };
        D(y, (b) => {
          a(k) ? b(_) : b(S, -1);
        });
      }
      x(v, g);
    }, f = /* @__PURE__ */ T(() => Array.isArray(t.value)), h = (v) => {
      var g = VO(), y = j(g, !0);
      L((_) => N(y, _), [() => JSON.stringify(t.value)]), x(v, g);
    }, p = (v) => {
      var g = ZO();
      Ae(g, 21, () => Object.entries(t.value), ([y, _]) => y, (y, _) => {
        var k = /* @__PURE__ */ T(() => fr(a(_), 2));
        let S = () => a(k)[0], b = () => a(k)[1];
        var $ = FO(), E = re($), C = j(E, !0), w = m(E, 2), O = M(w);
        pn(O, {
          get value() {
            return b();
          }
        }), L(() => N(C, S())), x(y, $);
      }), x(v, g);
    };
    D(s, (v) => {
      t.value === null || t.value === void 0 ? v(i) : a(c) ? v(l, 1) : typeof t.value == "string" || typeof t.value == "number" || typeof t.value == "boolean" ? v(u, 2) : a(f) ? v(d, 3) : r() ? v(h, 4) : v(p, -1);
    });
  }
  x(e, o), Me();
}
var UO = /* @__PURE__ */ z('<span class="min-w-0 font-mono break-all"> </span>'), BO = /* @__PURE__ */ z('<p class="break-words"> </p>'), WO = /* @__PURE__ */ z('<a class="break-all underline underline-offset-2" target="_blank" rel="noreferrer"> </a>'), HO = /* @__PURE__ */ z('<dt class="text-muted-foreground"> </dt> <dd class="min-w-0"><!></dd>', 1), qO = /* @__PURE__ */ z('<dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"></dl>'), GO = /* @__PURE__ */ z('<span class="text-muted-foreground"> </span>'), KO = /* @__PURE__ */ z('<div class="bg-muted/50 flex flex-col gap-1 rounded-md border px-2.5 py-1.5 text-xs"><div class="flex items-start gap-2"><!> <!></div> <!> <!> <!> <!></div>');
function Yf(e, t) {
  Ee(t, !0);
  const r = /* @__PURE__ */ T(() => Og(t.item)), n = /* @__PURE__ */ T(() => (Array.isArray(t.item.urls) ? t.item.urls : [t.item.urls]).filter(Ng)), o = /* @__PURE__ */ T(() => [
    t.item.observedAt,
    t.item.observedBy && `by ${String(t.item.observedBy)}`
  ].filter(Boolean).join(" ")), s = /* @__PURE__ */ T(() => Object.entries(t.item).filter(([S]) => !lz.has(S)));
  var i = KO(), l = M(i), c = M(l);
  {
    var u = (S) => {
      Jt(S, {
        variant: "outline",
        class: "shrink-0 font-mono text-[10px]",
        children: (b, $) => {
          var E = ct();
          L(() => N(E, t.item.source)), x(b, E);
        },
        $$slots: { default: !0 }
      });
    };
    D(c, (S) => {
      typeof t.item.source == "string" && S(u);
    });
  }
  var d = m(c, 2);
  {
    var f = (S) => {
      var b = UO(), $ = j(b, !0);
      L(() => N($, a(r))), x(S, b);
    };
    D(d, (S) => {
      a(r) && S(f);
    });
  }
  var h = m(l, 2);
  {
    var p = (S) => {
      var b = BO(), $ = j(b, !0);
      L(() => N($, t.item.note)), x(S, b);
    };
    D(h, (S) => {
      typeof t.item.note == "string" && S(p);
    });
  }
  var v = m(h, 2);
  Ae(v, 16, () => a(n), (S) => S, (S, b) => {
    var $ = WO(), E = j($, !0);
    L(() => {
      $e($, "href", b), N(E, b);
    }), x(S, $);
  });
  var g = m(v, 2);
  {
    var y = (S) => {
      var b = qO();
      Ae(b, 21, () => a(s), ([$, E]) => $, ($, E) => {
        var C = /* @__PURE__ */ T(() => fr(a(E), 2));
        let w = () => a(C)[0], O = () => a(C)[1];
        var A = HO(), R = re(A), W = j(R, !0), q = m(R, 2), P = M(q);
        pn(P, {
          get value() {
            return O();
          }
        }), L(() => N(W, w())), x($, A);
      }), x(S, b);
    };
    D(g, (S) => {
      a(s).length > 0 && S(y);
    });
  }
  var _ = m(g, 2);
  {
    var k = (S) => {
      var b = GO(), $ = j(b, !0);
      L(() => N($, a(o))), x(S, b);
    };
    D(_, (S) => {
      a(o) && S(k);
    });
  }
  x(e, i), Me();
}
var YO = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs">None.</p>'), XO = /* @__PURE__ */ z('<span class="tabular-nums"> </span>'), JO = /* @__PURE__ */ z("<span> <!></span>"), QO = /* @__PURE__ */ z('<span class="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 text-xs"></span>'), Xf = /* @__PURE__ */ z("<li><!></li>"), eN = /* @__PURE__ */ z('<details class="pl-7.5"><summary class="text-muted-foreground cursor-pointer text-xs"> </summary> <ul class="mt-1 flex flex-col gap-1.5"></ul></details>'), tN = /* @__PURE__ */ z('<li class="flex flex-col gap-1"><button type="button" class="hover:bg-muted flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm"><!> <span class="flex min-w-0 flex-col"><span class="text-muted-foreground flex items-center gap-1.5 text-xs"><span class="font-mono"> </span> <!></span> <span class="flex items-center gap-1.5"><!> <span class="truncate"> </span> <!></span> <!></span></button> <!></li>'), rN = /* @__PURE__ */ z('<ul class="flex flex-col gap-1"></ul>'), nN = /* @__PURE__ */ z('<section class="flex flex-col gap-2"><h3 class="section-title"> </h3> <!></section>'), oN = /* @__PURE__ */ z('<div class="flex flex-wrap gap-1"></div>'), sN = /* @__PURE__ */ z('<span class="font-mono"> </span> ', 1), iN = /* @__PURE__ */ z('<p class="text-muted-foreground -mt-3 text-xs"> <!></p>'), aN = /* @__PURE__ */ z('<dt class="text-muted-foreground">Confidence</dt> <dd class="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span class="bg-muted h-1.5 w-24 overflow-hidden rounded-full" aria-hidden="true"><span class="bg-foreground/70 block h-full rounded-full"></span></span> <span class="tabular-nums"> </span> <span class="text-muted-foreground text-xs"> </span></dd>', 1), lN = /* @__PURE__ */ z('<dt class="text-muted-foreground">Sources</dt> <dd class="flex flex-wrap gap-1"></dd>', 1), cN = /* @__PURE__ */ z('<dt class="text-muted-foreground">Authority</dt> <dd><!></dd>', 1), uN = /* @__PURE__ */ z('<dt class="text-muted-foreground">Captured by</dt> <dd><!></dd>', 1), dN = /* @__PURE__ */ z('<dt class="text-muted-foreground"> </dt> <dd class="min-w-0"><!></dd>', 1), fN = /* @__PURE__ */ z('<div class="text-muted-foreground text-xs"> </div> <ul class="flex flex-col gap-1.5"></ul>', 1), hN = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs">No evidence on file: nothing records where this was seen.</p>'), Jf = /* @__PURE__ */ z('<dt class="text-muted-foreground font-mono text-xs"> </dt> <dd class="min-w-0"><!></dd>', 1), pN = /* @__PURE__ */ z('<section class="flex flex-col gap-2"><h3 class="section-title">Attributes</h3> <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm"></dl></section>'), vN = /* @__PURE__ */ z('<!> <section class="flex flex-col gap-2"><h3 class="section-title">Notes</h3> <!></section>', 1), gN = /* @__PURE__ */ z('<section class="flex flex-col gap-2"><h3 class="section-title">Other frontmatter</h3> <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm"></dl></section>'), mN = /* @__PURE__ */ z('<div class="flex flex-col gap-5 p-4"><header class="flex flex-col gap-2"><div class="flex items-center gap-2"><!> <span class="text-muted-foreground text-sm"> </span></div> <h2 class="font-serif text-2xl leading-tight font-semibold"> </h2> <div class="flex items-center gap-1"><code class="bg-muted truncate rounded px-1.5 py-0.5 font-mono text-xs"> </code> <!></div> <div class="text-muted-foreground flex items-center gap-1.5 text-xs"><!> <span class="truncate font-mono"> </span></div> <!></header> <!> <section class="flex flex-col gap-2"><h3 class="section-title">Evidence and confidence</h3> <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm"><!> <!> <!> <!> <!></dl> <!></section> <!> <!> <!> <!> <!> <details class="text-sm"><summary class="section-title cursor-pointer">Raw frontmatter</summary> <pre class="bg-muted mt-2 overflow-x-auto rounded-md p-3 font-mono text-xs"> </pre></details></div>');
function bN(e, t) {
  Ee(t, !0);
  const r = /* @__PURE__ */ T(() => new Map(t.graph.entities.map((ze) => [ze.id, ze]))), n = /* @__PURE__ */ T(() => X3(t.graph, t.entity.id)), o = /* @__PURE__ */ T(() => t.entity.provenance ?? {}), s = /* @__PURE__ */ T(() => t.entity.assessment?.confidence ?? null), i = /* @__PURE__ */ T(() => t.entity.evidence), l = /* @__PURE__ */ T(() => Object.entries(a(o)).filter(([ze]) => !["authority", "confidence", "capturedBy", "evidence"].includes(ze))), c = /* @__PURE__ */ T(() => Object.entries(t.entity.attributes)), u = /* @__PURE__ */ T(() => Object.entries(t.entity.frontmatter).filter(([ze]) => ![
    "id",
    "type",
    "title",
    "tags",
    "attributes",
    "links",
    "provenance",
    "index",
    "evidence"
  ].includes(ze))), d = (ze) => ze >= 0.8 ? "high" : ze >= 0.5 ? "medium" : "low", f = (ze) => {
    navigator.clipboard?.writeText(ze);
  }, h = (ze, de) => {
    const we = de === "out" ? ze.target : ze.source;
    return { id: we, entity: a(r).get(we) };
  };
  var p = mN();
  {
    const ze = (de, we = dt, je = dt, Fe = dt) => {
      var Xe = nN(), ie = M(Xe), B = j(ie), ne = m(ie, 2);
      {
        var ge = (Ie) => {
          var qe = YO();
          x(Ie, qe);
        }, Te = (Ie) => {
          var qe = rN();
          Ae(qe, 21, je, xt, (Je, at) => {
            const Ot = /* @__PURE__ */ T(() => h(a(at), Fe()));
            var gt = tN(), st = M(gt), lt = M(st);
            {
              var er = (Ge) => {
                Gn(Ge, { class: "text-muted-foreground mt-0.5 size-3.5 shrink-0" });
              }, ar = (Ge) => {
                Kv(Ge, { class: "text-muted-foreground mt-0.5 size-3.5 shrink-0" });
              };
              D(lt, (Ge) => {
                Fe() === "out" ? Ge(er) : Ge(ar, -1);
              });
            }
            var Ar = m(lt, 2), mr = M(Ar), Er = M(mr), Mr = j(Er, !0), Ft = m(Er, 2);
            {
              var An = (Ge) => {
                var Ke = XO(), mt = j(Ke);
                L(
                  (kt, bt) => {
                    $e(Ke, "title", kt), N(mt, `· ${bt ?? ""}%${a(at).assessment.evidenceCount > 0 ? ` · ${a(at).assessment.evidenceCount} ${a(at).assessment.evidenceCount === 1 ? "observation" : "observations"}` : ""}`);
                  },
                  [
                    () => oc(a(at).assessment.basis),
                    () => Math.round(a(at).assessment.confidence * 100)
                  ]
                ), x(Ge, Ke);
              };
              D(Ft, (Ge) => {
                a(at).assessment && Ge(An);
              });
            }
            var En = m(mr, 2), Wr = M(En);
            {
              let Ge = /* @__PURE__ */ T(() => a(Ot).entity?.type ?? null);
              vr(Wr, {
                get type() {
                  return a(Ge);
                },
                size: "sm"
              });
            }
            var Mn = m(Wr, 2), Hr = j(Mn, !0), to = m(Mn, 2);
            {
              var ln = (Ge) => {
                Jt(Ge, {
                  variant: "outline",
                  class: "text-[10px]",
                  children: (Ke, mt) => {
                    var kt = ct("unresolved");
                    x(Ke, kt);
                  },
                  $$slots: { default: !0 }
                });
              };
              D(to, (Ge) => {
                a(Ot).entity || Ge(ln);
              });
            }
            var Tn = m(En, 2);
            {
              var ro = (Ge) => {
                var Ke = QO();
                Ae(Ke, 21, () => Object.entries(a(at).attributes), ([mt, kt]) => mt, (mt, kt) => {
                  var bt = /* @__PURE__ */ T(() => fr(a(kt), 2));
                  let Ut = () => a(bt)[0], br = () => a(bt)[1];
                  var Bt = JO(), Tr = M(Bt), ja = m(Tr);
                  pn(ja, {
                    get value() {
                      return br();
                    },
                    inline: !0
                  }), L(() => N(Tr, `${Ut() ?? ""}: `)), x(mt, Bt);
                }), x(Ge, Ke);
              }, Cn = /* @__PURE__ */ T(() => a(at).attributes && Object.keys(a(at).attributes).length > 0);
              D(Tn, (Ge) => {
                a(Cn) && Ge(ro);
              });
            }
            var On = m(st, 2);
            {
              var nt = (Ge) => {
                var Ke = eN(), mt = M(Ke), kt = j(mt), bt = m(mt, 2);
                Ae(bt, 21, () => a(at).evidence, xt, (Ut, br) => {
                  var Bt = Xf(), Tr = M(Bt);
                  Yf(Tr, {
                    get item() {
                      return a(br);
                    }
                  }), x(Ut, Bt);
                }), L(() => N(kt, `Evidence (${a(at).evidence.length ?? ""})`)), x(Ge, Ke);
              };
              D(On, (Ge) => {
                a(at).evidence && a(at).evidence.length > 0 && Ge(nt);
              });
            }
            L(() => {
              N(Mr, a(at).rel), N(Hr, a(Ot).entity?.title ?? a(Ot).id);
            }), ht("click", st, () => t.onselect(a(Ot).id)), x(Je, gt);
          }), x(Ie, qe);
        };
        D(ne, (Ie) => {
          je().length === 0 ? Ie(ge) : Ie(Te, -1);
        });
      }
      L(() => N(B, `${we() ?? ""} (${je().length ?? ""})`)), x(de, Xe);
    };
    var v = M(p), g = M(v), y = M(g);
    vr(y, {
      get type() {
        return t.entity.type;
      },
      size: "lg"
    });
    var _ = m(y, 2), k = j(_), S = m(g, 2), b = j(S, !0), $ = m(S, 2), E = M($), C = j(E, !0), w = m(E, 2);
    ft(w, {
      variant: "ghost",
      size: "icon-xs",
      "aria-label": "Copy id",
      onclick: () => f(t.entity.id),
      children: (de, we) => {
        IO(de, {});
      },
      $$slots: { default: !0 }
    });
    var O = m($, 2), A = M(O);
    Hu(A, { class: "size-3.5 shrink-0" });
    var R = m(A, 2), W = j(R, !0), q = m(O, 2);
    {
      var P = (de) => {
        var we = oN();
        Ae(we, 21, () => t.entity.tags, xt, (je, Fe) => {
          Jt(je, {
            variant: "secondary",
            children: (Xe, ie) => {
              var B = ct();
              L(() => N(B, a(Fe))), x(Xe, B);
            },
            $$slots: { default: !0 }
          });
        }), x(de, we);
      };
      D(q, (de) => {
        t.entity.tags.length > 0 && de(P);
      });
    }
    var H = m(v, 2);
    {
      var V = (de) => {
        var we = iN(), je = M(we), Fe = m(je);
        Ae(Fe, 18, () => t.entity.paths, (Xe) => Xe, (Xe, ie, B) => {
          var ne = sN(), ge = re(ne), Te = j(ge, !0), Ie = m(ge, 1, !0);
          L(() => {
            N(Te, ie), N(Ie, a(B) < t.entity.paths.length - 1 ? ", " : "");
          }), x(Xe, ne);
        }), L(() => N(je, `Merged from ${t.entity.paths.length ?? ""} files: `)), x(de, we);
      };
      D(H, (de) => {
        t.entity.paths && t.entity.paths.length > 1 && de(V);
      });
    }
    var Y = m(H, 2), oe = m(M(Y), 2), X = M(oe);
    {
      var I = (de) => {
        var we = aN(), je = m(re(we), 2), Fe = M(je), Xe = j(Fe), ie = m(Fe, 2), B = j(ie), ne = m(ie, 2), ge = j(ne);
        L(
          (Te, Ie, qe) => {
            Ln(Xe, `width: ${a(s) * 100}%`), N(B, `${Te ?? ""}%`), N(ge, `${Ie ?? ""}${qe ?? ""}`);
          },
          [
            () => Math.round(a(s) * 100),
            () => d(a(s)),
            () => t.entity.assessment ? ` · ${oc(t.entity.assessment.basis)}` : ""
          ]
        ), x(de, we);
      };
      D(X, (de) => {
        a(s) !== null && de(I);
      });
    }
    var te = m(X, 2);
    {
      var F = (de) => {
        var we = lN(), je = m(re(we), 2);
        Ae(je, 20, () => t.entity.assessment.sources, (Fe) => Fe, (Fe, Xe) => {
          Jt(Fe, {
            variant: "secondary",
            class: "font-mono text-[10px]",
            children: (ie, B) => {
              var ne = ct();
              L(() => N(ne, Xe)), x(ie, ne);
            },
            $$slots: { default: !0 }
          });
        }), x(de, we);
      };
      D(te, (de) => {
        t.entity.assessment && t.entity.assessment.sources.length > 0 && de(F);
      });
    }
    var Q = m(te, 2);
    {
      var pe = (de) => {
        var we = cN(), je = m(re(we), 2), Fe = M(je);
        pn(Fe, {
          get value() {
            return a(o).authority;
          }
        }), x(de, we);
      };
      D(Q, (de) => {
        a(o).authority !== void 0 && de(pe);
      });
    }
    var fe = m(Q, 2);
    {
      var G = (de) => {
        var we = uN(), je = m(re(we), 2), Fe = M(je);
        pn(Fe, {
          get value() {
            return a(o).capturedBy;
          }
        }), x(de, we);
      };
      D(fe, (de) => {
        a(o).capturedBy !== void 0 && de(G);
      });
    }
    var ve = m(fe, 2);
    Ae(ve, 17, () => a(l), ([de, we]) => de, (de, we) => {
      var je = /* @__PURE__ */ T(() => fr(a(we), 2));
      let Fe = () => a(je)[0], Xe = () => a(je)[1];
      var ie = dN(), B = re(ie), ne = j(B, !0), ge = m(B, 2), Te = M(ge);
      pn(Te, {
        get value() {
          return Xe();
        }
      }), L(() => N(ne, Fe())), x(de, ie);
    });
    var ke = m(oe, 2);
    {
      var se = (de) => {
        var we = fN(), je = re(we), Fe = j(je), Xe = m(je, 2);
        Ae(Xe, 21, () => a(i), xt, (ie, B) => {
          var ne = Xf(), ge = M(ne);
          Yf(ge, {
            get item() {
              return a(B);
            }
          }), x(ie, ne);
        }), L(() => N(Fe, `Evidence (${a(i).length ?? ""})`)), x(de, we);
      }, ye = (de) => {
        var we = hN();
        x(de, we);
      };
      D(ke, (de) => {
        a(i).length > 0 ? de(se) : de(ye, -1);
      });
    }
    var U = m(Y, 2);
    {
      var ee = (de) => {
        var we = pN(), je = m(M(we), 2);
        Ae(je, 21, () => a(c), ([Fe, Xe]) => Fe, (Fe, Xe) => {
          var ie = /* @__PURE__ */ T(() => fr(a(Xe), 2));
          let B = () => a(ie)[0], ne = () => a(ie)[1];
          var ge = Jf(), Te = re(ge), Ie = j(Te, !0), qe = m(Te, 2), Je = M(qe);
          pn(Je, {
            get value() {
              return ne();
            }
          }), L(() => N(Ie, B())), x(Fe, ge);
        }), x(de, we);
      };
      D(U, (de) => {
        a(c).length > 0 && de(ee);
      });
    }
    var ue = m(U, 2);
    ze(ue, () => "Cites", () => a(n).outgoing, () => "out");
    var me = m(ue, 2);
    ze(me, () => "Cited by", () => a(n).incoming, () => "in");
    var Re = m(me, 2);
    {
      var Ve = (de) => {
        var we = vN(), je = re(we);
        vm(je, {});
        var Fe = m(je, 2), Xe = m(M(Fe), 2);
        Fs(Xe, {
          get content() {
            return t.entity.content;
          },
          titleOf: (ie) => a(r).get(ie)?.title,
          get onselect() {
            return t.onselect;
          }
        }), x(de, we);
      }, _e = /* @__PURE__ */ T(() => t.entity.content.trim().length > 0);
      D(Re, (de) => {
        a(_e) && de(Ve);
      });
    }
    var Le = m(Re, 2);
    {
      var De = (de) => {
        var we = gN(), je = m(M(we), 2);
        Ae(je, 21, () => a(u), ([Fe, Xe]) => Fe, (Fe, Xe) => {
          var ie = /* @__PURE__ */ T(() => fr(a(Xe), 2));
          let B = () => a(ie)[0], ne = () => a(ie)[1];
          var ge = Jf(), Te = re(ge), Ie = j(Te, !0), qe = m(Te, 2), Je = M(qe);
          pn(Je, {
            get value() {
              return ne();
            }
          }), L(() => N(Ie, B())), x(Fe, ge);
        }), x(de, we);
      };
      D(Le, (de) => {
        a(u).length > 0 && de(De);
      });
    }
    var ce = m(Le, 2), xe = m(M(ce), 2), Se = j(xe, !0);
    L(
      (de, we) => {
        N(k, `Exhibit, ${de ?? ""}`), N(b, t.entity.title), N(C, t.entity.id), $e(R, "title", t.entity.path), N(W, t.entity.path), N(Se, we);
      },
      [
        () => t.entity.type.replaceAll("_", " "),
        () => JSON.stringify(t.entity.frontmatter, null, 2)
      ]
    );
  }
  x(e, p), Me();
}
Lt(["click"]);
var xN = /* @__PURE__ */ z('<div class="flex flex-col gap-2 p-4"><code class="bg-muted self-start rounded px-1.5 py-0.5 font-mono text-xs"> </code> <p class="text-muted-foreground text-sm">An exhibit cites this, but no file in <code class="font-mono">.docket/</code> defines it yet.</p></div>'), yN = /* @__PURE__ */ z('<div class="text-muted-foreground p-4 text-sm">That evidence belonged to an earlier answer. Ask again to inspect it.</div>'), _N = /* @__PURE__ */ z('<div class="text-muted-foreground flex flex-col gap-2 p-5 text-sm"><p class="text-foreground font-serif text-lg">Nothing selected</p> <p>Pick an exhibit on the board or in the table, or a piece of evidence in an answer, to read it here.</p> <p class="text-xs">Try <code class="font-mono">type:service</code>, <code class="font-mono">rel:depends_on</code> or <code class="font-mono">tag:core</code> in Find to narrow it down.</p></div>');
function wN(e, t) {
  Ee(t, !0);
  const r = zr(), n = /* @__PURE__ */ T(() => r.inspector), o = /* @__PURE__ */ T(() => a(n)?.kind === "exhibit" ? t.graph.entities.find((l) => l.id === a(n).id) : void 0), s = /* @__PURE__ */ T(() => a(n)?.kind === "evidence" ? r.ask.evidence.get(a(n).evidenceId) : void 0), i = /* @__PURE__ */ T(() => a(s) ? r.ask.outcome?.results.find((l) => l.adapter === a(s).adapter && l.state === "answered") : void 0);
  Wu(e, {
    class: "h-full",
    children: (l, c) => {
      var u = Ze(), d = re(u);
      {
        var f = (y) => {
          bN(y, {
            get graph() {
              return t.graph;
            },
            get entity() {
              return a(o);
            },
            onselect: (_) => r.select(_, { focus: !0 })
          });
        }, h = (y) => {
          var _ = xN(), k = M(_), S = j(k, !0);
          L(() => N(S, a(n).id)), x(y, _);
        }, p = (y) => {
          NO(y, {
            get graph() {
              return t.graph;
            },
            get evidence() {
              return a(s).evidence;
            },
            get result() {
              return a(i);
            }
          });
        }, v = (y) => {
          var _ = yN();
          x(y, _);
        }, g = (y) => {
          var _ = _N();
          x(y, _);
        };
        D(d, (y) => {
          a(n)?.kind === "exhibit" && a(o) ? y(f) : a(n)?.kind === "exhibit" ? y(h, 1) : a(n)?.kind === "evidence" && a(s) && a(i)?.state === "answered" ? y(p, 2) : a(n)?.kind === "evidence" ? y(v, 3) : y(g, -1);
        });
      }
      x(l, u);
    },
    $$slots: { default: !0 }
  }), Me();
}
var kN = /* @__PURE__ */ new Set([
  "$$slots",
  "$$events",
  "$$legacy",
  "ref",
  "class",
  "children"
]), SN = /* @__PURE__ */ z("<kbd><!></kbd>");
function $N(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = /* @__PURE__ */ K(t, kN);
  var o = SN();
  Et(o, (i) => ({ "data-slot": "kbd", class: i, ...n }), [
    () => sr("bg-muted text-muted-foreground in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 h-5 w-fit min-w-5 gap-1 rounded-sm px-1 font-sans text-xs font-medium [&_svg:not([class*='size-'])]:size-3 pointer-events-none inline-flex items-center justify-center select-none", t.class)
  ]);
  var s = M(o);
  vt(s, () => t.children ?? dt), _n(o, (i) => r(i), () => r()), x(e, o), Me();
}
var zN = /* @__PURE__ */ z('<div class="text-muted-foreground px-3 py-6 text-center text-sm">No exhibit or relationship matches.</div>'), AN = /* @__PURE__ */ z('<span class="text-muted-foreground truncate text-xs"> </span>'), EN = /* @__PURE__ */ z('<span class="text-muted-foreground truncate font-mono text-xs"> </span>'), MN = /* @__PURE__ */ z('<!> <span class="flex min-w-0 flex-1 flex-col"><span class="truncate"> </span> <!></span> <span class="text-muted-foreground shrink-0 text-xs"> </span>', 1), TN = /* @__PURE__ */ z('<span class="flex min-w-0 flex-1 items-center gap-1.5"><!> <span class="truncate"> </span> <span class="text-muted-foreground inline-flex shrink-0 items-center gap-0.5 font-mono text-xs"> <!></span> <span> </span></span> <span class="text-muted-foreground shrink-0 text-xs">relationship</span>', 1), CN = /* @__PURE__ */ z('<div role="option" tabindex="-1"><!></div>'), ON = /* @__PURE__ */ z('<div class="text-muted-foreground border-t px-2 pt-1.5 pb-1 text-[11px]"> </div>'), NN = /* @__PURE__ */ z('<div id="quick-results" role="listbox" class="bg-popover text-popover-foreground absolute top-full right-0 left-0 z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border p-1 shadow-lg"><!> <!> <!></div>'), PN = /* @__PURE__ */ z('<div class="relative w-full max-w-xl"><!> <input type="text" name="quick-search" role="combobox" aria-controls="quick-results" aria-label="Find exhibits and relationships in the loaded casebook" placeholder="Find in the casebook…  type: rel: tag:" autocomplete="off" spellcheck="false" class="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border pr-14 pl-8 text-sm outline-none focus-visible:ring-3"/> <!> <!></div>');
function IN(e, t) {
  Ee(t, !0);
  let r = /* @__PURE__ */ he(void 0), n = /* @__PURE__ */ he(""), o = /* @__PURE__ */ he(!1), s = /* @__PURE__ */ he(0);
  const i = /* @__PURE__ */ T(() => az(t.graph, a(n), 30)), l = /* @__PURE__ */ T(() => new Map(t.graph.entities.map((b) => [b.id, b.title]))), c = /* @__PURE__ */ T(() => new Map(t.graph.entities.map((b) => [b.id, b.type])));
  _t(() => {
    a(i), Z(s, 0);
  });
  function u(b) {
    b && (b.kind === "entity" ? t.onentity(b.entity.id) : t.onrelationship(b.edge), Z(o, !1), a(r)?.blur());
  }
  function d(b) {
    b.key === "ArrowDown" ? (b.preventDefault(), Z(s, Math.min(a(i).length - 1, a(s) + 1), !0)) : b.key === "ArrowUp" ? (b.preventDefault(), Z(s, Math.max(0, a(s) - 1), !0)) : b.key === "Enter" ? (b.preventDefault(), u(a(i)[a(s)])) : b.key === "Escape" && (Z(o, !1), a(r)?.blur());
  }
  function f(b) {
    const $ = b.composedPath()[0], E = $ instanceof HTMLElement && $.closest("input, textarea, [contenteditable]");
    (b.key === "k" && (b.metaKey || b.ctrlKey) || b.key === "/" && !E) && (b.preventDefault(), a(r)?.focus(), a(r)?.select());
  }
  _t(() => {
    a(o) && a(r)?.getRootNode()?.getElementById(`quick-${a(s)}`)?.scrollIntoView({ block: "nearest" });
  });
  const h = {
    id: "id",
    title: "title",
    type: "type",
    tag: "tag",
    attribute: "attribute",
    body: "notes"
  };
  var p = PN();
  jn("keydown", wl, f);
  var v = M(p);
  Xv(v, {
    class: "text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
  });
  var g = m(v, 2);
  _n(g, (b) => Z(r, b), () => a(r));
  var y = m(g, 2);
  $N(y, {
    class: "pointer-events-none absolute top-1/2 right-2 -translate-y-1/2",
    children: (b, $) => {
      var E = ct("⌘K");
      x(b, E);
    },
    $$slots: { default: !0 }
  });
  var _ = m(y, 2);
  {
    var k = (b) => {
      var $ = NN(), E = M($);
      {
        var C = (R) => {
          var W = zN();
          x(R, W);
        };
        D(E, (R) => {
          a(i).length === 0 && R(C);
        });
      }
      var w = m(E, 2);
      Ae(w, 17, () => a(i), xt, (R, W, q) => {
        var P = CN();
        $e(P, "id", `quick-${q}`);
        var H = M(P);
        {
          var V = (oe) => {
            var X = MN(), I = re(X);
            vr(I, {
              get type() {
                return a(W).entity.type;
              }
            });
            var te = m(I, 2), F = M(te), Q = j(F, !0), pe = m(F, 2);
            {
              var fe = (se) => {
                var ye = AN(), U = j(ye, !0);
                L(() => N(U, a(W).snippet)), x(se, ye);
              }, G = (se) => {
                var ye = EN(), U = j(ye, !0);
                L(() => N(U, a(W).entity.id)), x(se, ye);
              };
              D(pe, (se) => {
                a(W).snippet ? se(fe) : se(G, -1);
              });
            }
            var ve = m(te, 2), ke = j(ve, !0);
            L(() => {
              N(Q, a(W).entity.title), N(ke, a(W).entity.type);
            }), x(oe, X);
          }, Y = (oe) => {
            const X = /* @__PURE__ */ T(() => a(W).edge);
            var I = TN(), te = re(I), F = M(te);
            {
              let ye = /* @__PURE__ */ T(() => a(c).get(a(X).source) ?? null);
              vr(F, {
                get type() {
                  return a(ye);
                },
                size: "sm"
              });
            }
            var Q = m(F, 2), pe = j(Q, !0), fe = m(Q, 2), G = M(fe), ve = m(G);
            Gn(ve, { class: "size-3" });
            var ke = m(fe, 2), se = j(ke, !0);
            L(
              (ye, U) => {
                N(pe, ye), N(G, a(X).rel), Ye(ke, 1, `truncate ${a(X).dangling ? "text-muted-foreground italic" : ""}`), N(se, U);
              },
              [
                () => a(l).get(a(X).source) ?? a(X).source,
                () => a(l).get(a(X).target) ?? a(X).target
              ]
            ), x(oe, I);
          };
          D(H, (oe) => {
            a(W).kind === "entity" ? oe(V) : oe(Y, -1);
          });
        }
        L(() => {
          $e(P, "aria-selected", q === a(s)), Ye(P, 1, `flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${q === a(s) ? "bg-accent text-accent-foreground" : ""}`);
        }), ht("mousedown", P, (oe) => oe.preventDefault()), ht("click", P, () => u(a(W))), jn("mouseenter", P, () => Z(s, q, !0)), x(R, P);
      });
      var O = m(w, 2);
      {
        var A = (R) => {
          var W = ON(), q = j(W);
          L(() => N(q, `↑↓ to move · Enter to show on the board · ${a(i)[a(s)]?.kind === "entity" ? `matched ${h[a(i)[a(s)].field]}` : "relationship"}`)), x(R, W);
        };
        D(O, (R) => {
          a(i).length > 0 && R(A);
        });
      }
      x(b, $);
    }, S = /* @__PURE__ */ T(() => a(o) && a(n).trim() !== "");
    D(_, (b) => {
      a(S) && b(k);
    });
  }
  L(() => {
    $e(g, "aria-expanded", a(o) && a(i).length > 0), $e(g, "aria-activedescendant", a(o) && a(i).length > 0 ? `quick-${a(s)}` : void 0);
  }), jn("focus", g, () => Z(o, !0)), ht("input", g, () => Z(o, !0)), jn("blur", g, () => setTimeout(() => Z(o, !1), 120)), ht("keydown", g, d), Uo(g, () => a(n), (b) => Z(n, b)), x(e, p), Me();
}
Lt(["input", "keydown", "mousedown", "click"]);
var RN = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function DN(e, t) {
  let r = /* @__PURE__ */ K(t, RN);
  const n = {
    name: "circle-check",
    size: 24,
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "m16 9-5.5 5.5L8 12" }]
    ],
    aliases: ["check-circle-2"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var LN = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function jN(e, t) {
  let r = /* @__PURE__ */ K(t, LN);
  const n = {
    name: "circle-x",
    size: 24,
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "m15 9-6 6" }],
      ["path", { d: "m9 9 6 6" }]
    ],
    aliases: ["x-circle"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var VN = /* @__PURE__ */ z('<p class="text-muted-foreground font-serif italic">Reading the projections…</p>'), FN = /* @__PURE__ */ z('<dt class="font-mono"> </dt> <dd> </dd>', 1), ZN = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs">No adapter is enabled for projection in <code class="font-mono">.docket.yaml</code>, so a sync has nothing to do.</p>'), UN = /* @__PURE__ */ z('<p class="flex items-start gap-1.5 rounded-md border border-amber-600/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200" role="status"><!> </p>'), BN = /* @__PURE__ */ z('<p class="text-destructive flex items-start gap-1.5 text-xs break-words"><!> </p>'), WN = /* @__PURE__ */ z('<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt class="text-muted-foreground">Last synced</dt> <dd> </dd> <!></dl> <!> <!> <!>', 1), HN = /* @__PURE__ */ z("<option> </option>"), qN = /* @__PURE__ */ z("<!> Syncing…", 1), GN = /* @__PURE__ */ z("<!> Sync now", 1), KN = /* @__PURE__ */ z('<p class="text-destructive flex items-start gap-1.5 text-xs break-words" role="alert"><!> </p>'), YN = /* @__PURE__ */ z('<span class="text-muted-foreground font-normal"> </span>'), XN = /* @__PURE__ */ z('<p class="text-destructive text-xs break-words"> </p>'), JN = /* @__PURE__ */ z('<span class="text-destructive break-words"> </span>'), QN = /* @__PURE__ */ z('<li class="flex min-w-0 items-start gap-1.5"><!> <span class="flex min-w-0 flex-col"><span><code class="font-mono font-medium"> </code> <span class="text-muted-foreground"> </span></span> <!></span></li>'), eP = /* @__PURE__ */ z('<ul class="flex flex-col gap-1.5 text-xs"></ul>'), tP = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs"> </p>'), rP = /* @__PURE__ */ z('<div class="flex flex-col gap-2 border-t pt-3" aria-live="polite"><p> <!></p> <!> <!> <!></div>'), nP = /* @__PURE__ */ z(`<section aria-label="Sync" class="bg-popover absolute top-3 right-3 z-20 flex max-h-[80%] w-[26rem] max-w-[calc(100%-1.5rem)] flex-col rounded-lg border shadow-lg"><div class="flex items-center justify-between border-b px-3 py-2"><span class="section-title">Sync projections</span> <!></div> <div class="flex flex-col gap-3 overflow-y-auto px-3 py-3 text-sm"><p class="text-muted-foreground text-xs">Runs <code class="font-mono">docket sync</code>: projects the files changed since the last sync into each adapter's index. Search and
      Ask answer from those indexes.</p> <!> <div class="flex items-center gap-2"><label class="sr-only" for="sync-adapter">Adapters to sync</label> <select id="sync-adapter" class="border-input bg-background h-7 min-w-0 flex-1 rounded-md border px-2 text-xs disabled:opacity-50"><option>Every adapter</option><!></select> <!></div> <!> <!></div></section>`);
function oP(e, t) {
  Ee(t, !0), os(() => {
    t.sync.running || t.sync.refresh();
  });
  let r = /* @__PURE__ */ he(""), n = /* @__PURE__ */ he(Gt(Date.now()));
  _t(() => {
    const w = setInterval(() => Z(n, Date.now(), !0), 15e3);
    return () => clearInterval(w);
  });
  const o = /* @__PURE__ */ T(() => t.sync.status), s = /* @__PURE__ */ T(() => a(o)?.run ?? null), i = /* @__PURE__ */ T(() => a(o) ? oS(a(o)) : null), l = /* @__PURE__ */ T(() => a(o)?.adapters ?? []);
  var c = nP(), u = M(c), d = m(M(u), 2);
  ft(d, {
    variant: "ghost",
    size: "icon-xs",
    "aria-label": "Close",
    get onclick() {
      return t.onclose;
    },
    children: (w, O) => {
      Xs(w, {});
    },
    $$slots: { default: !0 }
  });
  var f = m(u, 2), h = m(M(f), 2);
  {
    var p = (w) => {
      var O = VN();
      x(w, O);
    }, v = (w) => {
      var O = WN(), A = re(O), R = m(M(A), 2), W = j(R, !0), q = m(R, 2);
      Ae(q, 17, () => a(l), (I) => I.id, (I, te) => {
        var F = FN(), Q = re(F), pe = j(Q, !0), fe = m(Q, 2), G = j(fe);
        L(
          (ve, ke) => {
            N(pe, a(te).id), Ye(fe, 1, Zo(a(te).state === "current" ? "text-emerald-700 dark:text-emerald-400" : a(te).state === "unknown" ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")), N(G, `${ve ?? ""}${ke ?? ""}`);
          },
          [
            () => nS(a(te)),
            () => a(te).lastSyncedAt ? ` · synced ${Kl(a(te).lastSyncedAt, a(n))}` : ""
          ]
        ), x(I, F);
      });
      var P = m(A, 2);
      {
        var H = (I) => {
          var te = ZN();
          x(I, te);
        };
        D(P, (I) => {
          a(l).length === 0 && !a(o).error && I(H);
        });
      }
      var V = m(P, 2);
      {
        var Y = (I) => {
          var te = UN(), F = M(te);
          or(F, { class: "mt-px size-3.5 shrink-0" });
          var Q = m(F, 1, !0);
          L(() => N(Q, a(i))), x(I, te);
        };
        D(V, (I) => {
          a(i) && I(Y);
        });
      }
      var oe = m(V, 2);
      {
        var X = (I) => {
          var te = BN(), F = M(te);
          or(F, { class: "mt-px size-3.5 shrink-0" });
          var Q = m(F, 1, !0);
          L(() => N(Q, a(o).error)), x(I, te);
        };
        D(oe, (I) => {
          a(o).error && I(X);
        });
      }
      L(
        (I) => {
          $e(R, "title", a(o).lastSyncedAt), N(W, I);
        },
        [
          () => a(o).lastSyncedAt ? Kl(a(o).lastSyncedAt, a(n)) : "never, as far as this docket recorded"
        ]
      ), x(w, O);
    };
    D(h, (w) => {
      a(o) === null && t.sync.failure === null ? w(p) : a(o) && w(v, 1);
    });
  }
  var g = m(h, 2), y = m(M(g), 2), _ = M(y);
  _.value = _.__value = "";
  var k = m(_);
  Ae(k, 17, () => a(l), (w) => w.id, (w, O) => {
    var A = HN(), R = j(A), W = {};
    L(() => {
      N(R, `Only ${a(O).id ?? ""}`), W !== (W = a(O).id) && (A.value = (A.__value = W) ?? "");
    }), x(w, A);
  }), zs(y);
  var S = m(y, 2);
  ft(S, {
    size: "sm",
    onclick: () => t.sync.start(a(r) === "" ? null : [a(r)]),
    get disabled() {
      return t.sync.running;
    },
    children: (w, O) => {
      var A = Ze(), R = re(A);
      {
        var W = (P) => {
          var H = qN(), V = re(H);
          Bn(V, { class: "animate-spin" }), x(P, H);
        }, q = (P) => {
          var H = GN(), V = re(H);
          pm(V, {}), x(P, H);
        };
        D(R, (P) => {
          t.sync.running ? P(W) : P(q, -1);
        });
      }
      x(w, A);
    },
    $$slots: { default: !0 }
  });
  var b = m(g, 2);
  {
    var $ = (w) => {
      var O = KN(), A = M(O);
      or(A, { class: "mt-px size-3.5 shrink-0" });
      var R = m(A, 1, !0);
      L(() => N(R, t.sync.failure)), x(w, O);
    };
    D(b, (w) => {
      t.sync.failure && w($);
    });
  }
  var E = m(b, 2);
  {
    var C = (w) => {
      var O = rP(), A = M(O), R = M(A), W = m(R);
      {
        var q = (I) => {
          var te = YN(), F = j(te);
          L((Q) => N(F, `Only ${Q ?? ""}.`), [() => a(s).adapters.join(", ")]), x(I, te);
        };
        D(W, (I) => {
          a(s).adapters && I(q);
        });
      }
      var P = m(A, 2);
      {
        var H = (I) => {
          var te = XN(), F = j(te, !0);
          L(() => N(F, a(s).error)), x(I, te);
        };
        D(P, (I) => {
          a(s).error && I(H);
        });
      }
      var V = m(P, 2);
      {
        var Y = (I) => {
          var te = eP();
          Ae(te, 21, () => a(s).results, (F) => F.id, (F, Q) => {
            var pe = QN(), fe = M(pe);
            {
              var G = (_e) => {
                Bn(_e, {
                  class: "text-muted-foreground mt-px size-3.5 shrink-0 animate-spin"
                });
              }, ve = (_e) => {
                DN(_e, { class: "mt-px size-3.5 shrink-0 text-emerald-600" });
              }, ke = (_e) => {
                jN(_e, { class: "text-destructive mt-px size-3.5 shrink-0" });
              };
              D(fe, (_e) => {
                a(Q).state === "waiting" ? _e(G) : a(Q).state === "synced" ? _e(ve, 1) : _e(ke, -1);
              });
            }
            var se = m(fe, 2), ye = M(se), U = M(ye), ee = j(U, !0), ue = m(U, 2), me = j(ue, !0), Re = m(ye, 2);
            {
              var Ve = (_e) => {
                var Le = JN(), De = j(Le, !0);
                L(() => N(De, a(Q).error)), x(_e, Le);
              };
              D(Re, (_e) => {
                a(Q).error && _e(Ve);
              });
            }
            L(
              (_e) => {
                N(ee, a(Q).id), N(me, _e);
              },
              [() => sS(a(Q))]
            ), x(F, pe);
          }), x(I, te);
        };
        D(V, (I) => {
          a(s).results.length > 0 && I(Y);
        });
      }
      var oe = m(V, 2);
      {
        var X = (I) => {
          var te = tP(), F = j(te);
          L(() => N(F, `${a(s).fileErrors === 1 ? "1 file has" : `${a(s).fileErrors} files have`} errors; adapters keep what those files last projected until they
            are fixed. See the validation findings.`)), x(I, te);
        };
        D(oe, (I) => {
          a(s).fileErrors > 0 && I(X);
        });
      }
      L(
        (I) => {
          Ye(A, 1, `text-xs font-medium ${a(s).state === "failed" ? "text-destructive" : ""}`), $e(A, "title", a(s).finishedAt ?? a(s).startedAt), N(R, `${I ?? ""} `);
        },
        [() => iS(a(s), a(n))]
      ), x(w, O);
    };
    D(E, (w) => {
      a(s) && w(C);
    });
  }
  L(() => y.disabled = t.sync.running), Pi(y, () => a(r), (w) => Z(r, w)), x(e, c), Me();
}
var sP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "ref", "class"]);
function Qf(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = /* @__PURE__ */ K(t, sP);
  var o = Ze(), s = re(o);
  {
    let i = /* @__PURE__ */ T(() => sr("text-sm flex-1 outline-none", t.class));
    It(s, () => Q$, (l, c) => {
      c(l, J(
        {
          "data-slot": "tabs-content",
          get class() {
            return a(i);
          }
        },
        () => n,
        {
          get ref() {
            return r();
          },
          set ref(u) {
            r(u);
          }
        }
      ));
    });
  }
  x(e, o), Me();
}
var iP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "ref", "class"]);
function eh(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = /* @__PURE__ */ K(t, iP);
  var o = Ze(), s = re(o);
  {
    let i = /* @__PURE__ */ T(() => sr("gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg:not([class*='size-'])]:size-4 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 relative inline-flex h-[calc(100%_-_1px)] flex-1 items-center justify-center whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0", "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent", "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground", "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100", t.class));
    It(s, () => s3, (l, c) => {
      c(l, J(
        {
          "data-slot": "tabs-trigger",
          get class() {
            return a(i);
          }
        },
        () => n,
        {
          get ref() {
            return r();
          },
          set ref(u) {
            r(u);
          }
        }
      ));
    });
  }
  x(e, o), Me();
}
var aP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "ref", "value", "class"]);
function lP(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = be(t, "value", 15, ""), o = /* @__PURE__ */ K(t, aP);
  var s = Ze(), i = re(s);
  {
    let l = /* @__PURE__ */ T(() => sr("gap-2 group/tabs flex data-horizontal:flex-col", t.class));
    It(i, () => Y$, (c, u) => {
      u(c, J(
        {
          "data-slot": "tabs",
          get class() {
            return a(l);
          }
        },
        () => o,
        {
          get ref() {
            return r();
          },
          set ref(d) {
            r(d);
          },
          get value() {
            return n();
          },
          set value(d) {
            n(d);
          }
        }
      ));
    });
  }
  x(e, s), Me();
}
const cP = Lc({
  base: "rounded-lg p-[3px] group-data-horizontal/tabs:h-8 data-[variant=line]:rounded-none group/tabs-list inline-flex w-fit items-center justify-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  variants: {
    variant: { default: "bg-muted", line: "gap-1 bg-transparent" }
  },
  defaultVariants: { variant: "default" }
});
var uP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy", "ref", "variant", "class"]);
function dP(e, t) {
  Ee(t, !0);
  let r = be(t, "ref", 15, null), n = be(t, "variant", 3, "default"), o = /* @__PURE__ */ K(t, uP);
  var s = Ze(), i = re(s);
  {
    let l = /* @__PURE__ */ T(() => sr(cP({ variant: n() }), t.class));
    It(i, () => r3, (c, u) => {
      u(c, J(
        {
          "data-slot": "tabs-list",
          get "data-variant"() {
            return n();
          },
          get class() {
            return a(l);
          }
        },
        () => o,
        {
          get ref() {
            return r();
          },
          set ref(d) {
            r(d);
          }
        }
      ));
    });
  }
  x(e, s), Me();
}
var fP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function hP(e, t) {
  let r = /* @__PURE__ */ K(t, fP);
  const n = {
    name: "activity",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var pP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function vP(e, t) {
  let r = /* @__PURE__ */ K(t, pP);
  const n = {
    name: "bell",
    size: 24,
    node: [
      ["path", { d: "M10.268 21a2 2 0 0 0 3.464 0" }],
      [
        "path",
        {
          d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var gP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function mP(e, t) {
  let r = /* @__PURE__ */ K(t, gP);
  const n = {
    name: "book-open",
    size: 24,
    node: [
      ["path", { d: "M12 5v16" }],
      [
        "path",
        {
          d: "M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var bP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function xP(e, t) {
  let r = /* @__PURE__ */ K(t, bP);
  const n = {
    name: "bot",
    size: 24,
    node: [
      ["path", { d: "M12 8V4H8" }],
      [
        "rect",
        { width: "16", height: "12", x: "4", y: "8", rx: "2" }
      ],
      ["path", { d: "M2 14h2" }],
      ["path", { d: "M20 14h2" }],
      ["path", { d: "M15 13v2" }],
      ["path", { d: "M9 13v2" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var yP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function _P(e, t) {
  let r = /* @__PURE__ */ K(t, yP);
  const n = {
    name: "box",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
        }
      ],
      ["path", { d: "m3.3 7 8.7 5 8.7-5" }],
      ["path", { d: "M12 22V12" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var wP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function kP(e, t) {
  let r = /* @__PURE__ */ K(t, wP);
  const n = {
    name: "boxes",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"
        }
      ],
      ["path", { d: "m7 16.5-4.74-2.85" }],
      ["path", { d: "m7 16.5 5-3" }],
      ["path", { d: "M7 16.5v5.17" }],
      [
        "path",
        {
          d: "M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"
        }
      ],
      ["path", { d: "m17 16.5-5-3" }],
      ["path", { d: "m17 16.5 4.74-2.85" }],
      ["path", { d: "M17 16.5v5.17" }],
      [
        "path",
        {
          d: "M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"
        }
      ],
      ["path", { d: "M12 8 7.26 5.15" }],
      ["path", { d: "m12 8 4.74-2.85" }],
      ["path", { d: "M12 13.5V8" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var SP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function $P(e, t) {
  let r = /* @__PURE__ */ K(t, SP);
  const n = {
    name: "brain",
    size: 24,
    node: [
      ["path", { d: "M12 18V5" }],
      [
        "path",
        { d: "M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" }
      ],
      [
        "path",
        { d: "M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" }
      ],
      ["path", { d: "M17.997 5.125a4 4 0 0 1 2.526 5.77" }],
      ["path", { d: "M18 18a4 4 0 0 0 2-7.464" }],
      [
        "path",
        { d: "M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" }
      ],
      ["path", { d: "M6 18a4 4 0 0 1-2-7.464" }],
      ["path", { d: "M6.003 5.125a4 4 0 0 0-2.526 5.77" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var zP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function AP(e, t) {
  let r = /* @__PURE__ */ K(t, zP);
  const n = {
    name: "briefcase",
    size: 24,
    node: [
      [
        "path",
        { d: "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" }
      ],
      [
        "rect",
        { width: "20", height: "14", x: "2", y: "6", rx: "2" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var EP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function MP(e, t) {
  let r = /* @__PURE__ */ K(t, EP);
  const n = {
    name: "bug",
    size: 24,
    node: [
      ["path", { d: "M12 20v-9" }],
      [
        "path",
        {
          d: "M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"
        }
      ],
      ["path", { d: "M14.12 3.88 16 2" }],
      ["path", { d: "M21 21a4 4 0 0 0-3.81-4" }],
      ["path", { d: "M21 5a4 4 0 0 1-3.55 3.97" }],
      ["path", { d: "M22 13h-4" }],
      ["path", { d: "M3 21a4 4 0 0 1 3.81-4" }],
      ["path", { d: "M3 5a4 4 0 0 0 3.55 3.97" }],
      ["path", { d: "M6 13H2" }],
      ["path", { d: "m8 2 1.88 1.88" }],
      ["path", { d: "M9 7.13V6a3 3 0 1 1 6 0v1.13" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var TP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function CP(e, t) {
  let r = /* @__PURE__ */ K(t, TP);
  const n = {
    name: "building",
    size: 24,
    node: [
      ["path", { d: "M12 10h.01" }],
      ["path", { d: "M12 14h.01" }],
      ["path", { d: "M12 6h.01" }],
      ["path", { d: "M16 10h.01" }],
      ["path", { d: "M16 14h.01" }],
      ["path", { d: "M16 6h.01" }],
      ["path", { d: "M8 10h.01" }],
      ["path", { d: "M8 14h.01" }],
      ["path", { d: "M8 6h.01" }],
      ["path", { d: "M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" }],
      [
        "rect",
        { x: "4", y: "2", width: "16", height: "20", rx: "2" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var OP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function NP(e, t) {
  let r = /* @__PURE__ */ K(t, OP);
  const n = {
    name: "calendar",
    size: 24,
    node: [
      ["path", { d: "M8 2v3" }],
      ["path", { d: "M16 2v3" }],
      [
        "rect",
        { x: "3", y: "3", width: "18", height: "18", rx: "2" }
      ],
      ["path", { d: "M3 9h18" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var PP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function IP(e, t) {
  let r = /* @__PURE__ */ K(t, PP);
  const n = {
    name: "chart-line",
    size: 24,
    node: [
      ["path", { d: "M3 3v16a2 2 0 0 0 2 2h16" }],
      ["path", { d: "m19 9-5 5-4-4-3 3" }]
    ],
    aliases: ["line-chart"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var RP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function DP(e, t) {
  let r = /* @__PURE__ */ K(t, RP);
  const n = {
    name: "circle-dot",
    size: 24,
    node: [
      ["circle", { cx: "12", cy: "12", r: "1" }],
      ["circle", { cx: "12", cy: "12", r: "10" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var LP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function jP(e, t) {
  let r = /* @__PURE__ */ K(t, LP);
  const n = {
    name: "clipboard-list",
    size: 24,
    node: [
      [
        "rect",
        {
          width: "8",
          height: "4",
          x: "8",
          y: "2",
          rx: "1",
          ry: "1"
        }
      ],
      [
        "path",
        {
          d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
        }
      ],
      ["path", { d: "M12 11h4" }],
      ["path", { d: "M12 16h4" }],
      ["path", { d: "M8 11h.01" }],
      ["path", { d: "M8 16h.01" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var VP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function FP(e, t) {
  let r = /* @__PURE__ */ K(t, VP);
  const n = {
    name: "clock",
    size: 24,
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "M12 6v6l4 2" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var ZP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function UP(e, t) {
  let r = /* @__PURE__ */ K(t, ZP);
  const n = {
    name: "cloud",
    size: 24,
    node: [
      [
        "path",
        { d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var BP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function WP(e, t) {
  let r = /* @__PURE__ */ K(t, BP);
  const n = {
    name: "code",
    size: 24,
    node: [
      ["path", { d: "m16 18 6-6-6-6" }],
      ["path", { d: "m8 6-6 6 6 6" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var HP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function qP(e, t) {
  let r = /* @__PURE__ */ K(t, HP);
  const n = {
    name: "cog",
    size: 24,
    node: [
      ["path", { d: "M11 10.27 7 3.34" }],
      ["path", { d: "m11 13.73-4 6.93" }],
      ["path", { d: "M12 22v-2" }],
      ["path", { d: "M12 2v2" }],
      ["path", { d: "M14 12h8" }],
      ["path", { d: "m17 20.66-1-1.73" }],
      ["path", { d: "m17 3.34-1 1.73" }],
      ["path", { d: "M2 12h2" }],
      ["path", { d: "m20.66 17-1.73-1" }],
      ["path", { d: "m20.66 7-1.73 1" }],
      ["path", { d: "m3.34 17 1.73-1" }],
      ["path", { d: "m3.34 7 1.73 1" }],
      ["circle", { cx: "12", cy: "12", r: "2" }],
      ["circle", { cx: "12", cy: "12", r: "8" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var GP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function KP(e, t) {
  let r = /* @__PURE__ */ K(t, GP);
  const n = {
    name: "container",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z"
        }
      ],
      ["path", { d: "M10 21.9V14L2.1 9.1" }],
      ["path", { d: "m10 14 11.9-6.9" }],
      ["path", { d: "M14 19.8v-8.1" }],
      ["path", { d: "M18 17.5V9.4" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var YP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function XP(e, t) {
  let r = /* @__PURE__ */ K(t, YP);
  const n = {
    name: "cpu",
    size: 24,
    node: [
      ["path", { d: "M12 20v2" }],
      ["path", { d: "M12 2v2" }],
      ["path", { d: "M17 20v2" }],
      ["path", { d: "M17 2v2" }],
      ["path", { d: "M2 12h2" }],
      ["path", { d: "M2 17h2" }],
      ["path", { d: "M2 7h2" }],
      ["path", { d: "M20 12h2" }],
      ["path", { d: "M20 17h2" }],
      ["path", { d: "M20 7h2" }],
      ["path", { d: "M7 20v2" }],
      ["path", { d: "M7 2v2" }],
      [
        "rect",
        { x: "4", y: "4", width: "16", height: "16", rx: "2" }
      ],
      [
        "rect",
        { x: "8", y: "8", width: "8", height: "8", rx: "1" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var JP = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function QP(e, t) {
  let r = /* @__PURE__ */ K(t, JP);
  const n = {
    name: "credit-card",
    size: 24,
    node: [
      [
        "rect",
        { width: "20", height: "14", x: "2", y: "5", rx: "2" }
      ],
      ["line", { x1: "2", x2: "22", y1: "10", y2: "10" }],
      ["path", { d: "M6 14h2" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var e7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function t7(e, t) {
  let r = /* @__PURE__ */ K(t, e7);
  const n = {
    name: "database",
    size: 24,
    node: [
      ["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" }],
      ["path", { d: "M3 5V19A9 3 0 0 0 21 19V5" }],
      ["path", { d: "M3 12A9 3 0 0 0 21 12" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var r7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function n7(e, t) {
  let r = /* @__PURE__ */ K(t, r7);
  const n = {
    name: "drafting-compass",
    size: 24,
    node: [
      ["path", { d: "m12.99 6.74 1.93 3.44" }],
      ["path", { d: "M19.136 12a10 10 0 0 1-14.271 0" }],
      ["path", { d: "m21 21-2.16-3.84" }],
      ["path", { d: "m3 21 8.02-14.26" }],
      ["circle", { cx: "12", cy: "5", r: "2" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var o7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function s7(e, t) {
  let r = /* @__PURE__ */ K(t, o7);
  const n = {
    name: "file",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
        }
      ],
      ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var i7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function a7(e, t) {
  let r = /* @__PURE__ */ K(t, i7);
  const n = {
    name: "file-check",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
        }
      ],
      ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
      ["path", { d: "m9 15 2 2 4-4" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var l7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function c7(e, t) {
  let r = /* @__PURE__ */ K(t, l7);
  const n = {
    name: "file-search",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
        }
      ],
      ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
      ["circle", { cx: "11.5", cy: "14.5", r: "2.5" }],
      ["path", { d: "M13.3 16.3 15 18" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var u7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function d7(e, t) {
  let r = /* @__PURE__ */ K(t, u7);
  const n = {
    name: "fingerprint-pattern",
    size: 24,
    node: [
      ["path", { d: "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" }],
      ["path", { d: "M14 13.12c0 2.38 0 6.38-1 8.88" }],
      ["path", { d: "M17.29 21.02c.12-.6.43-2.3.5-3.02" }],
      ["path", { d: "M2 12a10 10 0 0 1 18-6" }],
      ["path", { d: "M2 16h.01" }],
      ["path", { d: "M21.8 16c.2-2 .131-5.354 0-6" }],
      ["path", { d: "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" }],
      ["path", { d: "M8.65 22c.21-.66.45-1.32.57-2" }],
      ["path", { d: "M9 6.8a6 6 0 0 1 9 5.2v2" }]
    ],
    aliases: ["fingerprint"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var f7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function h7(e, t) {
  let r = /* @__PURE__ */ K(t, f7);
  const n = {
    name: "flag",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var p7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function v7(e, t) {
  let r = /* @__PURE__ */ K(t, p7);
  const n = {
    name: "flask-conical",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"
        }
      ],
      ["path", { d: "M6.453 15h11.094" }],
      ["path", { d: "M8.5 2h7" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var g7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function m7(e, t) {
  let r = /* @__PURE__ */ K(t, g7);
  const n = {
    name: "folder",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var b7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function x7(e, t) {
  let r = /* @__PURE__ */ K(t, b7);
  const n = {
    name: "folder-git-2",
    size: 24,
    node: [
      ["path", { d: "M18 19a5 5 0 0 1-5-5v8" }],
      [
        "path",
        {
          d: "M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5"
        }
      ],
      ["circle", { cx: "13", cy: "12", r: "2" }],
      ["circle", { cx: "20", cy: "19", r: "2" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var y7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function _7(e, t) {
  let r = /* @__PURE__ */ K(t, y7);
  const n = {
    name: "gauge",
    size: 24,
    node: [
      ["path", { d: "m12 14 4-4" }],
      ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var w7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function k7(e, t) {
  let r = /* @__PURE__ */ K(t, w7);
  const n = {
    name: "gavel",
    size: 24,
    node: [
      [
        "path",
        { d: "m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381" }
      ],
      ["path", { d: "m16 16 6-6" }],
      ["path", { d: "m21.5 10.5-8-8" }],
      ["path", { d: "m8 8 6-6" }],
      ["path", { d: "m8.5 7.5 8 8" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var S7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function $7(e, t) {
  let r = /* @__PURE__ */ K(t, S7);
  const n = {
    name: "git-branch",
    size: 24,
    node: [
      ["path", { d: "M15 6a9 9 0 0 0-9 9V3" }],
      ["circle", { cx: "18", cy: "6", r: "3" }],
      ["circle", { cx: "6", cy: "18", r: "3" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var z7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function A7(e, t) {
  let r = /* @__PURE__ */ K(t, z7);
  const n = {
    name: "git-commit-horizontal",
    size: 24,
    node: [
      ["circle", { cx: "12", cy: "12", r: "3" }],
      ["line", { x1: "3", x2: "9", y1: "12", y2: "12" }],
      ["line", { x1: "15", x2: "21", y1: "12", y2: "12" }]
    ],
    aliases: ["git-commit"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var E7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function M7(e, t) {
  let r = /* @__PURE__ */ K(t, E7);
  const n = {
    name: "git-pull-request",
    size: 24,
    node: [
      ["circle", { cx: "18", cy: "18", r: "3" }],
      ["circle", { cx: "6", cy: "6", r: "3" }],
      ["path", { d: "M13 6h3a2 2 0 0 1 2 2v7" }],
      ["line", { x1: "6", x2: "6", y1: "9", y2: "21" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var T7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function C7(e, t) {
  let r = /* @__PURE__ */ K(t, T7);
  const n = {
    name: "globe",
    size: 24,
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      [
        "path",
        { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }
      ],
      ["path", { d: "M2 12h20" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var O7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function N7(e, t) {
  let r = /* @__PURE__ */ K(t, O7);
  const n = {
    name: "handshake",
    size: 24,
    node: [
      ["path", { d: "m11 17 2 2a1 1 0 1 0 3-3" }],
      [
        "path",
        {
          d: "m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"
        }
      ],
      ["path", { d: "m21 3 1 11h-2" }],
      ["path", { d: "M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" }],
      ["path", { d: "M3 4h8" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var P7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function I7(e, t) {
  let r = /* @__PURE__ */ K(t, P7);
  const n = {
    name: "hard-drive",
    size: 24,
    node: [
      ["path", { d: "M10 16h.01" }],
      [
        "path",
        {
          d: "M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
        }
      ],
      ["path", { d: "M21.946 12.013H2.054" }],
      ["path", { d: "M6 16h.01" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var R7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function D7(e, t) {
  let r = /* @__PURE__ */ K(t, R7);
  const n = {
    name: "hash",
    size: 24,
    node: [
      ["line", { x1: "4", x2: "20", y1: "9", y2: "9" }],
      ["line", { x1: "4", x2: "20", y1: "15", y2: "15" }],
      ["line", { x1: "10", x2: "8", y1: "3", y2: "21" }],
      ["line", { x1: "16", x2: "14", y1: "3", y2: "21" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var L7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function j7(e, t) {
  let r = /* @__PURE__ */ K(t, L7);
  const n = {
    name: "inbox",
    size: 24,
    node: [
      [
        "polyline",
        { points: "22 12 16 12 14 15 10 15 8 12 2 12" }
      ],
      [
        "path",
        {
          d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var V7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function F7(e, t) {
  let r = /* @__PURE__ */ K(t, V7);
  const n = {
    name: "key-round",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
        }
      ],
      [
        "circle",
        { cx: "16.5", cy: "7.5", r: ".5", fill: "currentColor" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var Z7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function U7(e, t) {
  let r = /* @__PURE__ */ K(t, Z7);
  const n = {
    name: "landmark",
    size: 24,
    node: [
      ["path", { d: "M10 18v-7" }],
      [
        "path",
        {
          d: "M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z"
        }
      ],
      ["path", { d: "M14 18v-7" }],
      ["path", { d: "M18 18v-7" }],
      ["path", { d: "M3 22h18" }],
      ["path", { d: "M6 18v-7" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var B7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function W7(e, t) {
  let r = /* @__PURE__ */ K(t, B7);
  const n = {
    name: "layers",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"
        }
      ],
      [
        "path",
        {
          d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"
        }
      ],
      [
        "path",
        {
          d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"
        }
      ]
    ],
    aliases: ["layers-3"]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var H7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function q7(e, t) {
  let r = /* @__PURE__ */ K(t, H7);
  const n = {
    name: "layout-dashboard",
    size: 24,
    node: [
      [
        "rect",
        { width: "7", height: "9", x: "3", y: "3", rx: "1" }
      ],
      [
        "rect",
        { width: "7", height: "5", x: "14", y: "3", rx: "1" }
      ],
      [
        "rect",
        { width: "7", height: "9", x: "14", y: "12", rx: "1" }
      ],
      [
        "rect",
        { width: "7", height: "5", x: "3", y: "16", rx: "1" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var G7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function K7(e, t) {
  let r = /* @__PURE__ */ K(t, G7);
  const n = {
    name: "library",
    size: 24,
    node: [
      ["path", { d: "m16 6 4 14" }],
      ["path", { d: "M12 6v14" }],
      ["path", { d: "M8 8v12" }],
      ["path", { d: "M4 4v16" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var Y7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function X7(e, t) {
  let r = /* @__PURE__ */ K(t, Y7);
  const n = {
    name: "lightbulb",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"
        }
      ],
      ["path", { d: "M9 18h6" }],
      ["path", { d: "M10 22h4" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var J7 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function Q7(e, t) {
  let r = /* @__PURE__ */ K(t, J7);
  const n = {
    name: "link",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
        }
      ],
      [
        "path",
        {
          d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var eI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function tI(e, t) {
  let r = /* @__PURE__ */ K(t, eI);
  const n = {
    name: "list-checks",
    size: 24,
    node: [
      ["path", { d: "M13 5h8" }],
      ["path", { d: "M13 12h8" }],
      ["path", { d: "M13 19h8" }],
      ["path", { d: "m3 17 2 2 4-4" }],
      ["path", { d: "m3 7 2 2 4-4" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var rI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function nI(e, t) {
  let r = /* @__PURE__ */ K(t, rI);
  const n = {
    name: "lock",
    size: 24,
    node: [
      [
        "rect",
        {
          width: "18",
          height: "11",
          x: "3",
          y: "11",
          rx: "2",
          ry: "2"
        }
      ],
      ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var oI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function sI(e, t) {
  let r = /* @__PURE__ */ K(t, oI);
  const n = {
    name: "mail",
    size: 24,
    node: [
      ["path", { d: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" }],
      [
        "rect",
        { x: "2", y: "4", width: "20", height: "16", rx: "2" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var iI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function aI(e, t) {
  let r = /* @__PURE__ */ K(t, iI);
  const n = {
    name: "map",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"
        }
      ],
      ["path", { d: "M15 5.764v15" }],
      ["path", { d: "M9 3.236v15" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var lI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function cI(e, t) {
  let r = /* @__PURE__ */ K(t, lI);
  const n = {
    name: "megaphone",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
        }
      ],
      [
        "path",
        {
          d: "M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"
        }
      ],
      ["path", { d: "M8 6v8" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var uI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function dI(e, t) {
  let r = /* @__PURE__ */ K(t, uI);
  const n = {
    name: "message-square",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var fI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function hI(e, t) {
  let r = /* @__PURE__ */ K(t, fI);
  const n = {
    name: "milestone",
    size: 24,
    node: [
      ["path", { d: "M12 13v8" }],
      ["path", { d: "M12 3v3" }],
      [
        "path",
        {
          d: "M18.172 6a2 2 0 0 1 1.414.586l2.06 2.06a1.207 1.207 0 0 1 0 1.708l-2.06 2.06a2 2 0 0 1-1.414.586H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var pI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function vI(e, t) {
  let r = /* @__PURE__ */ K(t, pI);
  const n = {
    name: "monitor",
    size: 24,
    node: [
      [
        "rect",
        { width: "20", height: "14", x: "2", y: "3", rx: "2" }
      ],
      ["line", { x1: "8", x2: "16", y1: "21", y2: "21" }],
      ["line", { x1: "12", x2: "12", y1: "17", y2: "21" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var gI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function mI(e, t) {
  let r = /* @__PURE__ */ K(t, gI);
  const n = {
    name: "network",
    size: 24,
    node: [
      [
        "rect",
        { x: "16", y: "16", width: "6", height: "6", rx: "1" }
      ],
      [
        "rect",
        { x: "2", y: "16", width: "6", height: "6", rx: "1" }
      ],
      [
        "rect",
        { x: "9", y: "2", width: "6", height: "6", rx: "1" }
      ],
      ["path", { d: "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" }],
      ["path", { d: "M12 12V8" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var bI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function xI(e, t) {
  let r = /* @__PURE__ */ K(t, bI);
  const n = {
    name: "package",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"
        }
      ],
      ["path", { d: "M12 22V12" }],
      ["polyline", { points: "3.29 7 12 12 20.71 7" }],
      ["path", { d: "m7.5 4.27 9 5.15" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var yI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function _I(e, t) {
  let r = /* @__PURE__ */ K(t, yI);
  const n = {
    name: "puzzle",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var wI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function kI(e, t) {
  let r = /* @__PURE__ */ K(t, wI);
  const n = {
    name: "radio",
    size: 24,
    node: [
      ["path", { d: "M16.247 7.761a6 6 0 0 1 0 8.478" }],
      ["path", { d: "M19.075 4.933a10 10 0 0 1 0 14.134" }],
      ["path", { d: "M4.925 19.067a10 10 0 0 1 0-14.134" }],
      ["path", { d: "M7.753 16.239a6 6 0 0 1 0-8.478" }],
      ["circle", { cx: "12", cy: "12", r: "2" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var SI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function $I(e, t) {
  let r = /* @__PURE__ */ K(t, SI);
  const n = {
    name: "receipt",
    size: 24,
    node: [
      ["path", { d: "M12 17V7" }],
      ["path", { d: "M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" }],
      [
        "path",
        {
          d: "M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var zI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function AI(e, t) {
  let r = /* @__PURE__ */ K(t, zI);
  const n = {
    name: "rocket",
    size: 24,
    node: [
      ["path", { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" }],
      [
        "path",
        {
          d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"
        }
      ],
      [
        "path",
        {
          d: "M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"
        }
      ],
      [
        "path",
        { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var EI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function MI(e, t) {
  let r = /* @__PURE__ */ K(t, EI);
  const n = {
    name: "route",
    size: 24,
    node: [
      ["circle", { cx: "6", cy: "19", r: "3" }],
      [
        "path",
        { d: "M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" }
      ],
      ["circle", { cx: "18", cy: "5", r: "3" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var TI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function CI(e, t) {
  let r = /* @__PURE__ */ K(t, TI);
  const n = {
    name: "scroll-text",
    size: 24,
    node: [
      ["path", { d: "M15 12h-5" }],
      ["path", { d: "M15 8h-5" }],
      ["path", { d: "M19 17V5a2 2 0 0 0-2-2H4" }],
      [
        "path",
        {
          d: "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var OI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function NI(e, t) {
  let r = /* @__PURE__ */ K(t, OI);
  const n = {
    name: "server",
    size: 24,
    node: [
      [
        "rect",
        {
          width: "20",
          height: "8",
          x: "2",
          y: "2",
          rx: "2",
          ry: "2"
        }
      ],
      [
        "rect",
        {
          width: "20",
          height: "8",
          x: "2",
          y: "14",
          rx: "2",
          ry: "2"
        }
      ],
      ["line", { x1: "6", x2: "6.01", y1: "6", y2: "6" }],
      ["line", { x1: "6", x2: "6.01", y1: "18", y2: "18" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var PI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function II(e, t) {
  let r = /* @__PURE__ */ K(t, PI);
  const n = {
    name: "settings",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
        }
      ],
      ["circle", { cx: "12", cy: "12", r: "3" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var RI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function DI(e, t) {
  let r = /* @__PURE__ */ K(t, RI);
  const n = {
    name: "shield",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var LI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function jI(e, t) {
  let r = /* @__PURE__ */ K(t, LI);
  const n = {
    name: "shield-check",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        }
      ],
      ["path", { d: "m9 12 2 2 4-4" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var VI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function FI(e, t) {
  let r = /* @__PURE__ */ K(t, VI);
  const n = {
    name: "shopping-cart",
    size: 24,
    node: [
      [
        "path",
        {
          d: "m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18"
        }
      ],
      [
        "path",
        {
          d: "M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25"
        }
      ],
      ["circle", { cx: "18", cy: "20", r: "2" }],
      ["circle", { cx: "8", cy: "20", r: "2" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var ZI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function UI(e, t) {
  let r = /* @__PURE__ */ K(t, ZI);
  const n = {
    name: "siren",
    size: 24,
    node: [
      ["path", { d: "M7 18v-6a5 5 0 1 1 10 0v6" }],
      [
        "path",
        {
          d: "M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"
        }
      ],
      ["path", { d: "M21 12h1" }],
      ["path", { d: "M18.5 4.5 18 5" }],
      ["path", { d: "M2 12h1" }],
      ["path", { d: "M12 2v1" }],
      ["path", { d: "m4.929 4.929.707.707" }],
      ["path", { d: "M12 12v6" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var BI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function WI(e, t) {
  let r = /* @__PURE__ */ K(t, BI);
  const n = {
    name: "smartphone",
    size: 24,
    node: [
      [
        "rect",
        {
          width: "14",
          height: "20",
          x: "5",
          y: "2",
          rx: "2",
          ry: "2"
        }
      ],
      ["path", { d: "M12 18h.01" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var HI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function qI(e, t) {
  let r = /* @__PURE__ */ K(t, HI);
  const n = {
    name: "stamp",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"
        }
      ],
      [
        "path",
        {
          d: "M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z"
        }
      ],
      ["path", { d: "M5 22h14" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var GI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function KI(e, t) {
  let r = /* @__PURE__ */ K(t, GI);
  const n = {
    name: "star",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var YI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function XI(e, t) {
  let r = /* @__PURE__ */ K(t, YI);
  const n = {
    name: "tag",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"
        }
      ],
      [
        "circle",
        { cx: "7.5", cy: "7.5", r: ".5", fill: "currentColor" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var JI = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function QI(e, t) {
  let r = /* @__PURE__ */ K(t, JI);
  const n = {
    name: "target",
    size: 24,
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["circle", { cx: "12", cy: "12", r: "6" }],
      ["circle", { cx: "12", cy: "12", r: "2" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var e9 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function t9(e, t) {
  let r = /* @__PURE__ */ K(t, e9);
  const n = {
    name: "terminal",
    size: 24,
    node: [
      ["path", { d: "M12 19h8" }],
      ["path", { d: "m4 17 6-6-6-6" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var r9 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function n9(e, t) {
  let r = /* @__PURE__ */ K(t, r9);
  const n = {
    name: "user",
    size: 24,
    node: [
      ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }],
      ["circle", { cx: "12", cy: "7", r: "4" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var o9 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function s9(e, t) {
  let r = /* @__PURE__ */ K(t, o9);
  const n = {
    name: "users",
    size: 24,
    node: [
      ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
      ["path", { d: "M16 3.128a4 4 0 0 1 0 7.744" }],
      ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }],
      ["circle", { cx: "9", cy: "7", r: "4" }]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var i9 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function a9(e, t) {
  let r = /* @__PURE__ */ K(t, i9);
  const n = {
    name: "workflow",
    size: 24,
    node: [
      [
        "rect",
        { width: "8", height: "8", x: "3", y: "3", rx: "2" }
      ],
      ["path", { d: "M7 11v4a2 2 0 0 0 2 2h4" }],
      [
        "rect",
        { width: "8", height: "8", x: "13", y: "13", rx: "2" }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var l9 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function c9(e, t) {
  let r = /* @__PURE__ */ K(t, l9);
  const n = {
    name: "wrench",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
var u9 = /* @__PURE__ */ new Set(["$$slots", "$$events", "$$legacy"]);
function d9(e, t) {
  let r = /* @__PURE__ */ K(t, u9);
  const n = {
    name: "zap",
    size: 24,
    node: [
      [
        "path",
        {
          d: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"
        }
      ]
    ]
  };
  le(e, J(() => r, {
    get icon() {
      return n;
    }
  }));
}
const f9 = [
  "activity",
  "archive",
  "badge-check",
  "bell",
  "book-open",
  "bot",
  "box",
  "boxes",
  "brain",
  "briefcase",
  "bug",
  "building",
  "calendar",
  "chart-line",
  "circle-dot",
  "clipboard-list",
  "clock",
  "cloud",
  "code",
  "cog",
  "container",
  "cpu",
  "credit-card",
  "database",
  "drafting-compass",
  "eye",
  "file",
  "file-check",
  "file-search",
  "file-text",
  "fingerprint-pattern",
  "flag",
  "flask-conical",
  "folder",
  "folder-git-2",
  "gauge",
  "gavel",
  "git-branch",
  "git-commit-horizontal",
  "git-pull-request",
  "globe",
  "handshake",
  "hard-drive",
  "hash",
  "inbox",
  "key-round",
  "landmark",
  "layers",
  "layout-dashboard",
  "library",
  "lightbulb",
  "link",
  "list-checks",
  "lock",
  "mail",
  "map",
  "megaphone",
  "message-square",
  "milestone",
  "monitor",
  "network",
  "package",
  "plug",
  "puzzle",
  "radio",
  "receipt",
  "rocket",
  "route",
  "scale",
  "scroll-text",
  "server",
  "settings",
  "shield",
  "shield-check",
  "shopping-cart",
  "siren",
  "smartphone",
  "sparkles",
  "stamp",
  "star",
  "tag",
  "target",
  "terminal",
  "triangle-alert",
  "user",
  "users",
  "workflow",
  "wrench",
  "zap"
], h9 = "circle-dot", th = {
  agent: "bot",
  alert: "bell",
  api: "plug",
  architecture_record: "drafting-compass",
  artifact: "package",
  cluster: "network",
  compliance_requirement: "badge-check",
  constraint: "lock",
  container: "container",
  dashboard: "layout-dashboard",
  datasource: "database",
  decision: "gavel",
  document: "file-text",
  endpoint: "link",
  environment: "globe",
  event_stream: "radio",
  feature: "sparkles",
  feature_flag: "flag",
  incident: "siren",
  infrastructure: "cloud",
  library: "library",
  model: "brain",
  organization: "building",
  permit: "stamp",
  pipeline: "workflow",
  pod: "box",
  policy: "scroll-text",
  postmortem: "file-search",
  project: "briefcase",
  release: "rocket",
  repository: "folder-git-2",
  requirement: "list-checks",
  risk: "triangle-alert",
  runbook: "book-open",
  secret: "key-round",
  service: "server",
  slo: "gauge",
  system: "boxes",
  team: "users",
  test_suite: "flask-conical",
  vulnerability: "bug",
  work_item: "clipboard-list"
}, p9 = new Set(f9), v9 = (e) => p9.has(e), g9 = (e, t) => t !== void 0 && v9(t) ? t : Object.hasOwn(th, e) ? th[e] : h9, m9 = {
  activity: hP,
  archive: Bu,
  "badge-check": Ag,
  bell: vP,
  "book-open": mP,
  bot: xP,
  box: _P,
  boxes: kP,
  brain: $P,
  briefcase: AP,
  bug: MP,
  building: CP,
  calendar: NP,
  "chart-line": IP,
  "circle-dot": DP,
  "clipboard-list": jP,
  clock: FP,
  cloud: UP,
  code: WP,
  cog: qP,
  container: KP,
  cpu: XP,
  "credit-card": QP,
  database: t7,
  "drafting-compass": n7,
  eye: Ys,
  file: s7,
  "file-check": a7,
  "file-search": c7,
  "file-text": Hu,
  "fingerprint-pattern": d7,
  flag: h7,
  "flask-conical": v7,
  folder: m7,
  "folder-git-2": x7,
  gauge: _7,
  gavel: k7,
  "git-branch": $7,
  "git-commit-horizontal": A7,
  "git-pull-request": M7,
  globe: C7,
  handshake: N7,
  "hard-drive": I7,
  hash: D7,
  inbox: j7,
  "key-round": F7,
  landmark: U7,
  layers: W7,
  "layout-dashboard": q7,
  library: K7,
  lightbulb: X7,
  link: Q7,
  "list-checks": tI,
  lock: nI,
  mail: sI,
  map: aI,
  megaphone: cI,
  "message-square": dI,
  milestone: hI,
  monitor: vI,
  network: mI,
  package: xI,
  plug: qp,
  puzzle: _I,
  radio: kI,
  receipt: $I,
  rocket: AI,
  route: MI,
  scale: Yv,
  "scroll-text": CI,
  server: NI,
  settings: II,
  shield: DI,
  "shield-check": jI,
  "shopping-cart": FI,
  siren: UI,
  smartphone: WI,
  sparkles: Eg,
  stamp: qI,
  star: KI,
  tag: XI,
  target: QI,
  terminal: t9,
  "triangle-alert": Sg,
  user: n9,
  users: s9,
  workflow: a9,
  wrench: c9,
  zap: d9
}, b9 = (e, t) => m9[g9(e, t)];
var x9 = /* @__PURE__ */ z('<span class="text-spine-foreground hidden max-w-40 truncate text-sm 2xl:inline"> </span>'), y9 = /* @__PURE__ */ z("<a> </a>"), _9 = /* @__PURE__ */ z('<button type="button"> </button>'), w9 = /* @__PURE__ */ z("<!> ", 1), k9 = /* @__PURE__ */ z('<span class="text-spine-muted hidden text-xs tabular-nums 2xl:inline"> </span> <!>', 1), S9 = /* @__PURE__ */ z('<span class="absolute top-1 right-1 size-1.5 rounded-full bg-amber-300" aria-hidden="true"></span>'), $9 = /* @__PURE__ */ z('<!> <span class="hidden sm:inline"> </span> <!>', 1), z9 = /* @__PURE__ */ z('<div class="grid place-items-center p-6"><div class="flex max-w-lg flex-col gap-3 rounded-lg border p-5"><div class="flex items-center gap-2 font-serif text-lg"><!> Could not open the casebook</div> <p class="text-muted-foreground text-sm break-words"> </p> <!></div></div>'), A9 = /* @__PURE__ */ z('<div class="text-muted-foreground grid place-items-center font-serif italic">Opening the casebook…</div>'), E9 = /* @__PURE__ */ z('<span class="text-muted-foreground font-mono"> </span>'), M9 = /* @__PURE__ */ z('<li class="flex flex-col gap-0.5 px-3 py-2"><span class="flex items-center gap-1.5"><span> </span> <code class="font-mono"> </code></span> <span> </span> <!></li>'), T9 = /* @__PURE__ */ z('<div class="bg-popover absolute top-3 right-3 z-20 flex max-h-[60%] w-96 max-w-[calc(100%-1.5rem)] flex-col rounded-lg border shadow-lg"><div class="flex items-center justify-between border-b px-3 py-2"><span class="section-title"> </span> <!></div> <ul class="flex flex-col divide-y overflow-y-auto text-xs"></ul></div>'), C9 = /* @__PURE__ */ z("<!> <!>", 1), O9 = /* @__PURE__ */ z('<div class="flex items-center gap-2 border-b px-3 py-2"><!> <!></div> <!> <!>', 1), N9 = /* @__PURE__ */ z('<aside id="case-file" aria-label="Inspector" class="bg-background absolute inset-x-0 bottom-0 z-30 flex max-h-[60%] min-h-0 flex-col border-t shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] lg:relative lg:z-auto lg:max-h-none lg:w-[480px] lg:max-w-[45vw] lg:border-t-0 lg:border-l lg:shadow-none"><!></aside>'), P9 = /* @__PURE__ */ z('<div class="relative grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto]"><div class="relative min-h-0 min-w-0 overflow-hidden"><!> <!> <!></div> <!></div>'), I9 = /* @__PURE__ */ z('<div><header class="bg-spine text-spine-foreground flex items-center gap-3 border-b border-black/20 px-3 py-2"><div class="flex min-w-0 shrink-0 items-baseline gap-2.5"><span class="text-gilt font-serif text-xl leading-none font-semibold tracking-wide">docket</span> <span class="text-spine-muted hidden font-serif text-sm italic xl:inline">casebook of evidence</span> <!></div> <nav aria-label="Workspace" class="flex shrink-0 items-center gap-0.5"></nav> <div class="flex min-w-0 flex-1 justify-center text-foreground"><!></div> <div class="flex shrink-0 items-center gap-1"><!> <!> <!> <!> <!></div></header> <!></div>');
function R9(e, t) {
  Ee(t, !0);
  let r = be(t, "workspace", 7), n = be(t, "initial", 3, null), o = be(t, "theme", 3, null), s = be(t, "class", 3, "h-dvh"), i = /* @__PURE__ */ he(!1);
  const l = /* @__PURE__ */ T(() => r().graph);
  os(() => {
    r().load().then(() => {
      n() && r().select(n(), { focus: !0 });
    }), r().sync.refresh();
    let F = Date.now();
    const Q = () => {
      Date.now() - F > 2e3 && (r().load(), r().sync.running || r().sync.refresh()), F = Date.now();
    };
    return window.addEventListener("focus", Q), () => {
      window.removeEventListener("focus", Q), r().sync.stop();
    };
  });
  const c = /* @__PURE__ */ T(() => H3(a(l)?.entities ?? [])), u = (F) => Y3(a(c).get(F)), d = /* @__PURE__ */ T(() => new Map(a(l)?.types.map((F) => [F.name, F.icon]) ?? []));
  b3({ colour: u, icon: (F) => b9(F, a(d).get(F)) });
  async function h() {
    t.nav.route !== "browse" && await t.nav.go("browse"), r().browseView = "graph";
  }
  const p = /* @__PURE__ */ T(() => r().sync.running), v = /* @__PURE__ */ T(() => r().sync.status?.outOfDate ?? !1), g = /* @__PURE__ */ T(() => a(l)?.diagnostics ?? []), y = /* @__PURE__ */ T(() => a(g).filter((F) => F.severity === "error").length);
  var _ = I9(), k = M(_), S = M(k), b = m(M(S), 4);
  {
    var $ = (F) => {
      var Q = x9(), pe = j(Q, !0);
      L(() => {
        $e(Q, "title", a(l).project.root), N(pe, a(l).project.name);
      }), x(F, Q);
    };
    D(b, (F) => {
      a(l) && F($);
    });
  }
  var E = m(S, 2);
  Ae(E, 21, () => d3, (F) => F.id, (F, Q) => {
    const pe = /* @__PURE__ */ T(() => t.nav.href(a(Q).id)), fe = /* @__PURE__ */ T(() => `rounded-md px-2.5 py-1 text-sm transition-colors ${t.nav.route === a(Q).id ? "bg-white/15 text-spine-foreground font-medium" : "text-spine-muted hover:text-spine-foreground hover:bg-white/10"}`);
    var G = Ze(), ve = re(G);
    {
      var ke = (ye) => {
        var U = y9(), ee = j(U, !0);
        L(() => {
          $e(U, "href", a(pe)), Ye(U, 1, Zo(a(fe))), $e(U, "aria-current", t.nav.route === a(Q).id ? "page" : void 0), N(ee, a(Q).label);
        }), x(ye, U);
      }, se = (ye) => {
        var U = _9(), ee = j(U, !0);
        L(() => {
          Ye(U, 1, Zo(a(fe))), $e(U, "aria-current", t.nav.route === a(Q).id ? "page" : void 0), N(ee, a(Q).label);
        }), ht("click", U, () => t.nav.go(a(Q).id)), x(ye, U);
      };
      D(ve, (ye) => {
        a(pe) !== null ? ye(ke) : ye(se, -1);
      });
    }
    x(F, G);
  });
  var C = m(E, 2), w = M(C);
  {
    var O = (F) => {
      IN(F, {
        get graph() {
          return a(l);
        },
        onentity: (Q) => {
          h().then(() => r().select(Q, { focus: !0 }));
        },
        onrelationship: (Q) => {
          h().then(() => r().pickEdge(Q));
        }
      });
    };
    D(w, (F) => {
      a(l) && F(O);
    });
  }
  var A = m(C, 2), R = M(A);
  {
    var W = (F) => {
      var Q = k9(), pe = re(Q), fe = j(pe), G = m(pe, 2);
      {
        var ve = (ke) => {
          ft(ke, {
            variant: "ghost",
            size: "sm",
            class: "hover:text-spine-foreground hover:bg-white/10",
            onclick: () => {
              Z(i, !a(i)), a(i) && (r().syncOpen = !1);
            },
            get "aria-expanded"() {
              return a(i);
            },
            "aria-label": "Validation findings",
            children: (se, ye) => {
              var U = w9(), ee = re(U);
              {
                let me = /* @__PURE__ */ T(() => a(y) > 0 ? "text-red-300" : "text-amber-300");
                or(ee, {
                  get class() {
                    return a(me);
                  }
                });
              }
              var ue = m(ee);
              L(() => N(ue, ` ${a(g).length ?? ""}`)), x(se, U);
            },
            $$slots: { default: !0 }
          });
        };
        D(G, (ke) => {
          a(g).length > 0 && ke(ve);
        });
      }
      L(() => N(fe, `${a(l).entities.length ?? ""} ${a(l).entities.length === 1 ? "exhibit" : "exhibits"}, ${a(l).edges.length ?? ""}
          ${a(l).edges.length === 1 ? "relationship" : "relationships"}`)), x(F, Q);
    };
    D(R, (F) => {
      a(l) && F(W);
    });
  }
  var q = m(R, 2);
  {
    let F = /* @__PURE__ */ T(() => a(p) ? "Syncing the projections" : a(v) ? "Sync the projections - out of date" : "Sync the projections"), Q = /* @__PURE__ */ T(() => a(v) ? "Projections out of date with the files" : "Run docket sync");
    ft(q, {
      variant: "ghost",
      size: "sm",
      class: "hover:text-spine-foreground relative hover:bg-white/10",
      get "aria-label"() {
        return a(F);
      },
      get "aria-expanded"() {
        return r().syncOpen;
      },
      get title() {
        return a(Q);
      },
      onclick: () => {
        r().syncOpen = !r().syncOpen, r().syncOpen && Z(i, !1);
      },
      children: (pe, fe) => {
        var G = $9(), ve = re(G);
        {
          let ee = /* @__PURE__ */ T(() => a(p) ? "animate-pulse" : "");
          pm(ve, {
            get class() {
              return a(ee);
            }
          });
        }
        var ke = m(ve, 2), se = j(ke, !0), ye = m(ke, 2);
        {
          var U = (ee) => {
            var ue = S9();
            x(ee, ue);
          };
          D(ye, (ee) => {
            a(v) && !a(p) && ee(U);
          });
        }
        L(() => N(se, a(p) ? "Syncing…" : "Sync")), x(pe, G);
      },
      $$slots: { default: !0 }
    });
  }
  var P = m(q, 2);
  ft(P, {
    variant: "ghost",
    size: "icon-sm",
    class: "hover:text-spine-foreground hover:bg-white/10",
    "aria-label": "Reload from the files",
    onclick: () => r().load(),
    get disabled() {
      return r().loading;
    },
    children: (F, Q) => {
      {
        let pe = /* @__PURE__ */ T(() => r().loading ? "animate-spin" : "");
        Oc(F, {
          get class() {
            return a(pe);
          }
        });
      }
    },
    $$slots: { default: !0 }
  });
  var H = m(P, 2);
  {
    var V = (F) => {
      {
        let Q = /* @__PURE__ */ T(() => o().dark ? "Use the light theme" : "Use the dark theme");
        ft(F, {
          variant: "ghost",
          size: "icon-sm",
          class: "hover:text-spine-foreground hover:bg-white/10",
          get "aria-label"() {
            return a(Q);
          },
          get onclick() {
            return o().toggle;
          },
          children: (pe, fe) => {
            var G = Ze(), ve = re(G);
            {
              var ke = (ye) => {
                ZC(ye, {});
              }, se = (ye) => {
                DC(ye, {});
              };
              D(ve, (ye) => {
                o().dark ? ye(ke) : ye(se, -1);
              });
            }
            x(pe, G);
          },
          $$slots: { default: !0 }
        });
      }
    };
    D(H, (F) => {
      o() && F(V);
    });
  }
  var Y = m(H, 2);
  {
    let F = /* @__PURE__ */ T(() => r().panelOpen ? "Collapse the inspector" : "Open the inspector");
    ft(Y, {
      variant: "ghost",
      size: "icon-sm",
      class: "hover:text-spine-foreground hover:bg-white/10",
      get "aria-label"() {
        return a(F);
      },
      get "aria-pressed"() {
        return r().panelOpen;
      },
      "aria-controls": "case-file",
      onclick: () => r().panelOpen = !r().panelOpen,
      children: (Q, pe) => {
        var fe = Ze(), G = re(fe);
        {
          var ve = (se) => {
            qf(se, {});
          }, ke = (se) => {
            jC(se, {});
          };
          D(G, (se) => {
            r().panelOpen ? se(ve) : se(ke, -1);
          });
        }
        x(Q, fe);
      },
      $$slots: { default: !0 }
    });
  }
  var oe = m(k, 2);
  {
    var X = (F) => {
      var Q = z9(), pe = M(Q), fe = M(pe), G = M(fe);
      or(G, { class: "text-destructive size-4" });
      var ve = m(fe, 2), ke = j(ve, !0), se = m(ve, 2);
      ft(se, {
        variant: "outline",
        onclick: () => r().load(),
        children: (ye, U) => {
          var ee = ct("Try again");
          x(ye, ee);
        },
        $$slots: { default: !0 }
      }), L(() => N(ke, r().loadError)), x(F, Q);
    }, I = (F) => {
      var Q = A9();
      x(F, Q);
    }, te = (F) => {
      var Q = P9(), pe = M(Q), fe = M(pe);
      vt(fe, () => t.children);
      var G = m(fe, 2);
      {
        var ve = (ee) => {
          oP(ee, {
            get sync() {
              return r().sync;
            },
            onclose: () => r().syncOpen = !1
          });
        };
        D(G, (ee) => {
          r().syncOpen && ee(ve);
        });
      }
      var ke = m(G, 2);
      {
        var se = (ee) => {
          var ue = T9(), me = M(ue), Re = M(me), Ve = j(Re), _e = m(Re, 2);
          ft(_e, {
            variant: "ghost",
            size: "icon-xs",
            "aria-label": "Close",
            onclick: () => Z(i, !1),
            children: (De, ce) => {
              Xs(De, {});
            },
            $$slots: { default: !0 }
          });
          var Le = m(me, 2);
          Ae(Le, 21, () => a(g), xt, (De, ce) => {
            var xe = M9(), Se = M(xe), ze = M(Se), de = j(ze, !0), we = m(ze, 2), je = j(we, !0), Fe = m(Se, 2), Xe = j(Fe, !0), ie = m(Fe, 2);
            {
              var B = (ne) => {
                var ge = E9(), Te = j(ge, !0);
                L(() => N(Te, a(ce).path)), x(ne, ge);
              };
              D(ie, (ne) => {
                a(ce).path && ne(B);
              });
            }
            L(() => {
              Ye(ze, 1, `font-medium ${a(ce).severity === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`), N(de, a(ce).severity), N(je, a(ce).code), N(Xe, a(ce).message);
            }), x(De, xe);
          }), L(() => N(Ve, `Validation findings (${a(g).length ?? ""})`)), x(ee, ue);
        };
        D(ke, (ee) => {
          a(i) && a(g).length > 0 && ee(se);
        });
      }
      var ye = m(pe, 2);
      {
        var U = (ee) => {
          var ue = N9(), me = M(ue);
          It(me, () => lP, (Re, Ve) => {
            Ve(Re, {
              class: "flex min-h-0 flex-1 flex-col gap-0",
              get value() {
                return r().sideTab;
              },
              set value(_e) {
                r().sideTab = _e;
              },
              children: (_e, Le) => {
                var De = O9(), ce = re(De), xe = M(ce);
                It(xe, () => dP, (we, je) => {
                  je(we, {
                    class: "flex-1",
                    children: (Fe, Xe) => {
                      var ie = C9(), B = re(ie);
                      It(B, () => eh, (ge, Te) => {
                        Te(ge, {
                          value: "inspector",
                          children: (Ie, qe) => {
                            var Je = ct("Inspector");
                            x(Ie, Je);
                          },
                          $$slots: { default: !0 }
                        });
                      });
                      var ne = m(B, 2);
                      It(ne, () => eh, (ge, Te) => {
                        Te(ge, {
                          value: "chat",
                          children: (Ie, qe) => {
                            var Je = ct("Chat");
                            x(Ie, Je);
                          },
                          $$slots: { default: !0 }
                        });
                      }), x(Fe, ie);
                    },
                    $$slots: { default: !0 }
                  });
                });
                var Se = m(xe, 2);
                ft(Se, {
                  variant: "ghost",
                  size: "icon-sm",
                  "aria-label": "Collapse the inspector",
                  onclick: () => r().panelOpen = !1,
                  children: (we, je) => {
                    qf(we, {});
                  },
                  $$slots: { default: !0 }
                });
                var ze = m(ce, 2);
                It(ze, () => Qf, (we, je) => {
                  je(we, {
                    value: "inspector",
                    class: "min-h-0 flex-1",
                    children: (Fe, Xe) => {
                      wN(Fe, {
                        get graph() {
                          return a(l);
                        }
                      });
                    },
                    $$slots: { default: !0 }
                  });
                });
                var de = m(ze, 2);
                It(de, () => Qf, (we, je) => {
                  je(we, {
                    value: "chat",
                    class: "min-h-0 flex-1",
                    children: (Fe, Xe) => {
                      sO(Fe, {
                        get graph() {
                          return a(l);
                        },
                        onshow: (ie, B) => {
                          B?.reveal ? h().then(() => r().showScope(df(ie))) : r().showScope(df(ie));
                        },
                        onselect: (ie) => r().select(ie, { focus: !0 }),
                        get turns() {
                          return r().turns;
                        },
                        set turns(ie) {
                          r().turns = ie;
                        }
                      });
                    },
                    $$slots: { default: !0 }
                  });
                }), x(_e, De);
              },
              $$slots: { default: !0 }
            });
          }), x(ee, ue);
        };
        D(ye, (ee) => {
          r().panelOpen && ee(U);
        });
      }
      x(F, Q);
    };
    D(oe, (F) => {
      r().loadError && !a(l) ? F(X) : a(l) ? F(te, -1) : F(I, 1);
    });
  }
  L(() => Ye(_, 1, `grid ${s() ?? ""} grid-rows-[auto_1fr]`)), x(e, _), Me();
}
Lt(["click"]);
function D9(e, t) {
  Ee(t, !0);
  const r = dS(new uS(Gp(t.url))), n = h3(new f3()), o = /* @__PURE__ */ T(() => r.graph);
  R9(e, {
    get workspace() {
      return r;
    },
    get nav() {
      return n;
    },
    class: "min-h-0 flex-1",
    children: (s, i) => {
      var l = Ze(), c = re(l);
      {
        var u = (h) => {
          _T(h, {
            get graph() {
              return a(o);
            }
          });
        }, d = (h) => {
          OS(h, {
            get graph() {
              return a(o);
            }
          });
        }, f = (h) => {
          PC(h, {});
        };
        D(c, (h) => {
          n.route === "ask" ? h(u) : n.route === "adapters" ? h(d, 1) : h(f, -1);
        });
      }
      x(s, l);
    },
    $$slots: { default: !0 }
  }), Me();
}
const L9 = "wheelhouse-docket-casebook.v1", rh = "viewer", j9 = (e) => typeof e == "object" && e !== null && e.schema === L9, V9 = (e, t) => e.state === "connected" && (t === void 0 || t?.state === "running" && t.url === e.url), F9 = (e) => typeof e == "object" && e !== null && e.service === "docket-open", Z9 = async (e, t, r, n) => {
  if (!e)
    return { state: "blocked", title: "Not available", detail: "Wheelhouse has not said where this project’s docket is.", hint: null };
  if (e.state === "none")
    return {
      state: "blocked",
      title: "No docket here",
      detail: "This project’s clone has no .docket.yaml. Run docket init in it to start one.",
      hint: null
    };
  if (e.problem) return { state: "blocked", title: "docket cannot be shown here", detail: e.problem, hint: t?.hint ?? null };
  if (!e.origins.includes(r))
    return {
      state: "blocked",
      title: "This Wheelhouse is not one docket’s viewer allows",
      detail: `Wheelhouse is open at ${r}, but docket’s viewer is started to allow ${e.origins.join(" and ") || "no other page"}. Add "${r}" to "origins" in the docket plugin’s settings in Wheelhouse’s plugins.json, then restart the viewer.`,
      hint: null
    };
  if (!t)
    return { state: "blocked", title: "Not available", detail: "This Wheelhouse has no docket viewer for this project.", hint: null };
  if (t.state === "running" && t.url) {
    let o;
    try {
      o = await n(t.url);
    } catch {
      return {
        state: "offline",
        title: "docket’s viewer does not answer this page",
        detail: `A docket viewer runs at ${t.url}, but not for Wheelhouse: it was started by hand, or by a docket without --allow-origin. Stop it, then launch it from here, or start it with the command below.`,
        hint: t.hint,
        launchable: !1,
        starting: !1
      };
    }
    return F9(o) ? { state: "connected", url: t.url } : {
      state: "offline",
      title: "docket’s viewer is out of date",
      detail: `The docket viewer at ${t.url} is too old to be shown in Wheelhouse. Update docket, stop the viewer and launch it again.`,
      hint: t.hint,
      launchable: !1,
      starting: !1
    };
  }
  return {
    state: "offline",
    title: t.state === "starting" ? "docket’s viewer is starting" : t.state === "failed" ? "docket’s viewer did not start" : t.state === "occupied" ? "Something else answers at the viewer’s address" : t.state === "unavailable" ? "docket’s viewer cannot run here" : "docket’s viewer is not running",
    detail: t.reason ?? (t.state === "stopped" ? "The casebook - Browse, Ask, Adapters, the inspector, chat and sync - is drawn from the project’s docket viewer (docket open). Launch it to open the casebook here." : null),
    hint: t.hint,
    launchable: t.launchable,
    starting: t.state === "starting"
  };
};
var U9 = /* @__PURE__ */ z('<div class="text-muted-foreground grid flex-1 place-items-center font-serif italic">Opening the casebook…</div>'), B9 = /* @__PURE__ */ z('<p class="text-muted-foreground text-sm break-words"> </p>'), W9 = /* @__PURE__ */ z('<p class="text-destructive text-sm break-words"> </p>'), H9 = /* @__PURE__ */ z('<pre class="bg-muted max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap"> </pre>'), q9 = /* @__PURE__ */ z('<div class="flex flex-col gap-1"><span class="text-muted-foreground text-xs">To start it by hand:</span> <code class="bg-muted rounded-md px-2 py-1.5 font-mono text-xs break-all select-all"> </code></div>'), G9 = /* @__PURE__ */ z("<!> ", 1), K9 = /* @__PURE__ */ z("<!> Check again", 1), Y9 = /* @__PURE__ */ z('<p class="text-muted-foreground text-xs">Wheelhouse opens docket’s own page in a new tab once the viewer answers; the casebook opens here too.</p>'), X9 = /* @__PURE__ */ z('<div class="grid flex-1 place-items-center p-6"><div class="bg-card flex w-full max-w-xl flex-col gap-3 rounded-lg border p-5" role="status"><div class="flex items-center gap-2 font-serif text-lg"><!> </div> <!> <!> <!> <!> <div class="flex flex-wrap items-center gap-2"><!> <!></div> <!></div></div>'), J9 = /* @__PURE__ */ z("<div><!></div>");
function Q9(e, t) {
  Ee(t, !0);
  const r = 5e3;
  let n = /* @__PURE__ */ he(Gt({ state: "checking" })), o = /* @__PURE__ */ he(!1), s = /* @__PURE__ */ he(null), i = /* @__PURE__ */ he(null);
  const l = async (y) => {
    const _ = await fetch(`${y.replace(/\/+$/, "")}/api/health`, { cache: "no-store" });
    return _.ok ? _.json() : null;
  };
  let c = 0;
  async function u() {
    const y = ++c;
    let _;
    try {
      _ = t.host ? await t.host.service(rh) : null;
    } catch {
      _ = void 0;
    }
    if (y !== c || V9(a(n), _)) return;
    const k = await Z9(j9(t.data) ? t.data : null, _ ?? null, t.origin, l);
    y === c && (Z(n, k, !0), Z(i, _?.log ?? null, !0));
  }
  async function d() {
    if (t.host) {
      Z(o, !0), Z(s, null);
      try {
        const y = await t.host.launch(rh);
        (y?.state === "failed" || y?.state === "unavailable") && Z(s, y.reason ?? "Wheelhouse could not start it.", !0);
      } catch (y) {
        Z(s, y instanceof Error ? y.message : String(y), !0);
      } finally {
        Z(o, !1);
      }
      await u();
    }
  }
  os(() => {
    u();
    const y = setInterval(
      () => {
        a(n).state !== "connected" && !a(o) && u();
      },
      r
    );
    return () => clearInterval(y);
  }), _t(() => {
    t.data, u();
  });
  var f = J9(), h = M(f);
  {
    var p = (y) => {
      var _ = Ze(), k = re(_);
      Nb(k, () => a(n).url, (S) => {
        D9(S, {
          get url() {
            return a(n).url;
          }
        });
      }), x(y, _);
    }, v = (y) => {
      var _ = U9();
      x(y, _);
    }, g = (y) => {
      var _ = X9(), k = M(_), S = M(k), b = M(S);
      {
        var $ = (F) => {
          Bn(F, { class: "text-muted-foreground size-4 animate-spin" });
        }, E = (F) => {
          or(F, { class: "text-muted-foreground size-4" });
        };
        D(b, (F) => {
          a(n).state === "offline" && a(n).starting ? F($) : F(E, -1);
        });
      }
      var C = m(b), w = m(S, 2);
      {
        var O = (F) => {
          var Q = B9(), pe = j(Q, !0);
          L(() => N(pe, a(n).detail)), x(F, Q);
        };
        D(w, (F) => {
          a(n).detail && F(O);
        });
      }
      var A = m(w, 2);
      {
        var R = (F) => {
          var Q = W9(), pe = j(Q, !0);
          L(() => N(pe, a(s))), x(F, Q);
        };
        D(A, (F) => {
          a(s) && F(R);
        });
      }
      var W = m(A, 2);
      {
        var q = (F) => {
          var Q = H9(), pe = j(Q, !0);
          L(() => N(pe, a(i))), x(F, Q);
        };
        D(W, (F) => {
          a(i) && F(q);
        });
      }
      var P = m(W, 2);
      {
        var H = (F) => {
          var Q = q9(), pe = m(M(Q), 2), fe = j(pe, !0);
          L(() => N(fe, a(n).hint)), x(F, Q);
        };
        D(P, (F) => {
          a(n).hint && F(H);
        });
      }
      var V = m(P, 2), Y = M(V);
      {
        var oe = (F) => {
          {
            let Q = /* @__PURE__ */ T(() => a(o) || a(n).starting);
            ft(F, {
              onclick: d,
              get disabled() {
                return a(Q);
              },
              children: (pe, fe) => {
                var G = G9(), ve = re(G);
                {
                  var ke = (U) => {
                    Bn(U, { class: "animate-spin" });
                  }, se = (U) => {
                    c0(U, {});
                  };
                  D(ve, (U) => {
                    a(o) ? U(ke) : U(se, -1);
                  });
                }
                var ye = m(ve);
                L(() => N(ye, ` ${a(o) ? "Starting…" : "Launch"}`)), x(pe, G);
              },
              $$slots: { default: !0 }
            });
          }
        };
        D(Y, (F) => {
          a(n).state === "offline" && a(n).launchable && F(oe);
        });
      }
      var X = m(Y, 2);
      ft(X, {
        variant: "outline",
        onclick: () => u(),
        get disabled() {
          return a(o);
        },
        children: (F, Q) => {
          var pe = K9(), fe = re(pe);
          Oc(fe, {}), x(F, pe);
        },
        $$slots: { default: !0 }
      });
      var I = m(V, 2);
      {
        var te = (F) => {
          var Q = Y9();
          x(F, Q);
        };
        D(I, (F) => {
          a(n).state === "offline" && a(n).launchable && F(te);
        });
      }
      L(() => N(C, ` ${a(n).title ?? ""}`)), x(y, _);
    };
    D(h, (y) => {
      a(n).state === "connected" ? y(p) : a(n).state === "checking" ? y(v, 1) : y(g, -1);
    });
  }
  L(() => Ye(f, 1, `flex min-h-0 flex-1 flex-col text-foreground ${t.dark ? "dark" : ""}`)), x(e, f), Me();
}
const nh = "docket-casebook";
class eR extends HTMLElement {
  // Raw: Wheelhouse's values are its own, and its host API is frozen.
  #e = /* @__PURE__ */ he(null);
  #t = /* @__PURE__ */ he(null);
  #r = /* @__PURE__ */ he(!1);
  #o = null;
  #n = null;
  #s = null;
  get host() {
    return a(this.#e);
  }
  set host(t) {
    Z(this.#e, t);
  }
  get entry() {
    return this.#o;
  }
  set entry(t) {
    this.#o = t;
  }
  get data() {
    return a(this.#t);
  }
  set data(t) {
    Z(this.#t, t);
  }
  connectedCallback() {
    if (this.#n) return;
    const t = this.shadowRoot ?? this.attachShadow({ mode: "open" }), r = document.createElement("style");
    r.textContent = Jb, t.replaceChildren(r);
    const n = document.documentElement, o = () => {
      Z(this.#r, n.classList.contains("dark"), !0);
    };
    o(), this.#s = new MutationObserver(o), this.#s.observe(n, { attributes: !0, attributeFilter: ["class"] });
    const s = this;
    this.#n = Ab(Q9, {
      target: t,
      props: {
        get host() {
          return a(s.#e);
        },
        get data() {
          return a(s.#t);
        },
        get dark() {
          return a(s.#r);
        },
        origin: location.origin
      }
    });
  }
  disconnectedCallback() {
    this.#s?.disconnect(), this.#s = null, this.#n && Mb(this.#n), this.#n = null;
  }
}
customElements.get(nh) || customElements.define(nh, eR);
export {
  eR as DocketCasebookElement,
  nh as TAG
};
