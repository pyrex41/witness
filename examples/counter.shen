\\ counter.shen — TEA runtime example (not runnable in Node CLI; browser harness TBD)
\\
\\ Demonstrates:
\\   - TEA (The Elm Architecture) with typed messages and model
\\   - Layout proof: static button labels checked at compile time via proven-text
\\   - handled-text for dynamic counter display (overflow = visible)
\\   - Tailwind-style layout classes
\\
\\ Status: load-time proofs verify (witness dev examples/counter.shen).
\\ The `run-app` TEA runtime needs a browser harness (DOM globals); not yet wired.
\\
\\ Model = (@p count N) where N is a number
\\ Messages = increment | decrement

\\ --- Static text proofs (Tier 1: checked at load time) ---
\\ Compiler verifies these fit at file-load time (~1ms)
\\ measure("-", sans-serif 14) checks OK
\\ measure("+", sans-serif 14) checks OK

(assert-fits "-" (mk-font "sans-serif" 14) 96)
(assert-fits "+" (mk-font "sans-serif" 14) 96)

\\ --- Init ---

(define counter-init
  _ -> (@p (@p count 0) cmd-none))

\\ --- Update ---

(define counter-update
  increment (@p count N) -> (@p (@p count (+ N 1)) cmd-none)
  decrement (@p count N) -> (@p (@p count (- N 1)) cmd-none)
  _ M -> (@p M cmd-none))

\\ --- View: layout proofs checked at compile time ---
\\ The tw macro builds [frame Props Children] nodes.
\\ text-node wraps safe-text (proven-text or handled-text) into node.
\\ Dynamic counter value uses handled-text with visible overflow.

(define counter-view
  (@p count N) ->
    (tw [flex flex-col items-center gap-4 p-8]
      [(text-node (handled-text (str N) (mk-font "sans-serif" 32) 200 visible))
       (tw [flex gap-2]
         [(counter-button (proven-text "-" (mk-font "sans-serif" 14) 96) decrement)
          (counter-button (proven-text "+" (mk-font "sans-serif" 14) 96) increment)])]))

\\ Button carries a pre-proven cell. proven-text must be called with a
\\ literal string at its use site under the Phase 4 trust model; passing
\\ a variable would be rejected at load time. The assert-fits calls
\\ above are a belt-and-suspenders check.
(define counter-button
  Cell Msg ->
    (tw [px-4 py-2 rounded-lg text-sm font-medium]
      [(text-node Cell)]))

\\ --- Run the app (requires DOM; omitted for CLI checking) ---
\\ (run-app (mk-app counter-init counter-update counter-view (/. _ sub-none))
\\   unit
\\   (dom-renderer "root"))
