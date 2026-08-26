# Oxject

> src/Oxject.js

Property access and assignment look like a plain object; the reactivity is invisible, built on the platform's own EventTarget rather than a custom pub/sub layer. Callers write `state.count++` and anything subscribed to `count` updates automatically, with no special setter syntax, no `.value` unwrapping, and no compile step.

The constructor returns a Proxy rather than the instance itself, making invisible assignment interception possible without changing the call site. `instanceof Oxject` returns false as a consequence.

## The container only accepts a plain object

- constructing with anything other than a plain object is an error; null, arrays, strings, and primitives are all rejected immediately
  - does constructing with a non-plain-object value (null, an array, a primitive) throw?
  - does constructing with a plain object succeed?

## isOxject distinguishes a real instance from a plain object with similar shape
**method:** `isOxject`

- `Oxject.isOxject(thing)` is the supported way to check whether a value is a reactive container, rather than callers guessing from shape or `instanceof` -- which would fail anyway, since the constructor returns a Proxy, not an Oxject instance
  - isOxject(new _SubjectCtor({ x: 1 })) → true
  - isOxject({ x: 1 }) → false

## Property changes are immediate and synchronous

- assigning to a property notifies all subscribers before the assignment expression returns; there is no async tick and no deferred flush
  - does a subscriber fire before the next line of code executes?

## Subscriptions are key-scoped

- a subscription fires only when its registered key changes; changes to other properties do not trigger it
  - does a subscriber for one key not fire when a different key changes?

## Subscribers receive the new value directly

- the callback receives the value just assigned; it does not need to re-read from the state object
  - does the subscriber receive the new value as its argument?

## Assigning the same value does nothing

- if the incoming value is equal to the stored value, no subscribers are notified and no events are dispatched
  - does assigning the same value as the current one not call subscribers?

## The platform's event system is the notification infrastructure

- the instance is itself an EventTarget; property changes dispatch events natively; addEventListener is a valid alternative to subscribe(), and AbortSignal and `{ once }` work without any additional support
  - does addEventListener work as a subscription path?
  - does a listener added with `{ once: true }` fire only once?
  - does a listener added with `{ signal }` stop when the signal aborts?

## Destruction stops all further activity

- destroy() removes all managed subscriptions and prevents any further dispatch; the instance is permanently inert afterward
  - do subscribers not fire after destroy()?
  - is isDestroyed true after destroy()?
  - is calling destroy() twice safe?

---

**derive() produces a derived value from an explicit input list.** The selector declares what to watch. The combiner says what to compute. Those two concerns stay separate. The selector runs once at construction to wire subscriptions; the combiner runs whenever any input changes. The result behaves like a live reactive handle with the same transparent proxy behavior as subscriber().

## Inputs are declared once and never change
**module:** `src/derive.js`

- the selector runs at construction to discover what to watch; only what is read on that first run becomes a subscription; conditional branches not taken are never subscribed and cannot become subscriptions later
  - does a value not read during the first selector run not trigger recomputation when it changes?

## A selector with no reactive inputs is an error
**module:** `src/derive.js`

- if the selector reads nothing reactive, the derivation can never update; this is caught at construction rather than silently producing a value that will never change
  - does a selector that reads only static values, none of them reactive, throw when the derivation is constructed?

## The combiner receives inputs in selector order
**module:** `src/derive.js`

- the combiner is called with the values from the selector array in the same order; its return value is the derived result
  - does the combiner receive values in the order they appear in the selector?

## Subscribers are notified when any input changes
**module:** `src/derive.js`

- subscribing to a derivation works like subscribing to a property; the subscriber fires whenever any input changes and the combiner produces a new result
  - does a subscriber fire when an input changes?
  - does it receive the new derived value?
