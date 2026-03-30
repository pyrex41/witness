\\ tea.shen — The Elm Architecture runtime
\\
\\ Model/Update/View cycle with commands as data.
\\ Side effects are represented as cmd values, executed by the runtime.

\\===== Command types =====
\\Commands are data, not side effects. The runtime interprets them.

(datatype cmd-types
  ___
  cmd-none : cmd;

  ____________________
  [cmd-batch Cmds] : cmd;

  Url : string; OnOk : symbol; OnErr : symbol;
  ______________________________________________
  [cmd-http Url OnOk OnErr] : cmd;

  Ms : number; Msg : symbol;
  ____________________________
  [cmd-delay Ms Msg] : cmd;)

\\===== Subscription types =====

(datatype sub-types
  ___
  sub-none : sub;

  Ms : number; Msg : symbol;
  ___________________________
  [sub-every Ms Msg] : sub;)

\\===== App record =====
\\An app is [Init Update View Subs]
\\Init : (Flags --> (@p Model cmd))
\\Update : (Msg --> Model --> (@p Model cmd))
\\View : (Model --> node)
\\Subs : (Model --> sub)

(define mk-app
  Init Update View Subs -> [Init Update View Subs])

(define get-init
  App -> (hd App))

(define get-update
  App -> (hd (tl App)))

(define get-view
  App -> (hd (tl (tl App))))

(define get-subs
  App -> (hd (tl (tl (tl App)))))

\\===== Global state =====
\\Mutable refs for the running app

(set *model* [])
(set *app* [])
(set *renderer* [])
(set *render-pending* false)

\\===== Command execution =====

(define execute-cmd
  cmd-none -> true
  [cmd-batch []] -> true
  [cmd-batch [C | Cs]] -> (do (execute-cmd C) (execute-cmd [cmd-batch Cs]))
  [cmd-delay Ms Msg] -> (do (set *pending-delay* (@p Ms Msg)) true)
  [cmd-http Url OnOk OnErr] -> (do (set *pending-http* (@p Url (@p OnOk OnErr))) true)
  _ -> true)

\\===== Rendering =====

(define render-frame
  -> (let App (value *app*)
          Model (value *model*)
          Renderer (value *renderer*)
          Tree ((get-view App) Model)
          Layout (solve-layout Tree 800 600)
          _ (Renderer Layout)
       (set *render-pending* false)))

(define schedule-render
  -> (if (value *render-pending*)
         true
         (do (set *render-pending* true)
             (render-frame))))

\\===== Dispatch =====

(define dispatch
  Msg -> (let App (value *app*)
              Model (value *model*)
              Result ((get-update App) Msg Model)
              NewModel (fst Result)
              Cmd (snd Result)
              _ (set *model* NewModel)
              _ (execute-cmd Cmd)
           (schedule-render)))

\\===== Run app =====

(define run-app
  App Flags Renderer ->
    (let Result ((get-init App) Flags)
         Model (fst Result)
         Cmd (snd Result)
         _ (set *model* Model)
         _ (set *app* App)
         _ (set *renderer* Renderer)
         _ (execute-cmd Cmd)
      (render-frame)))

\\===== Declarations for type checking =====

(declare mk-app [A --> B --> C --> D --> [list E]])
(declare get-init [[list A] --> A])
(declare get-update [[list A] --> A])
(declare get-view [[list A] --> A])
(declare get-subs [[list A] --> A])
(declare run-app [[list A] --> B --> C --> D])
(declare dispatch [symbol --> boolean])
(declare render-frame [--> boolean])
(declare schedule-render [--> boolean])
(declare execute-cmd [cmd --> boolean])
