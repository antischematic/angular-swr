# Angular SWR

Data fetching for Angular 14+

## Usage

Create a service that fetches data

```ts
const endpoint = "https://jsonplaceholder.typicode.com/todos"

@Injectable({ providedIn: "root" })
export class Fetcher implements Fetchable<Todo[]> {
   private http = inject(HttpClient)
   
   fetch(userId: string) {
      return this.http.get(endpoint, { params: { userId }})
   }
}
```

Create a resource

```ts
import { createResource, revalidateOnFocus, revalidateOnReconnect } from "@mmuscat/angular-swr"

export const TODOS = createResource(Fetcher, {
   features: [
      revalidateOnFocus(), 
      revalidateOnReconnect()
   ]
})
```

Provide and use resource in component

```ts
import { TODOS } from "./resource"

@Component({
   selector: "app-todos",
   templateUrl: "./todos.component.html",
   providers: [TODOS],
})
export class TodosComponent {
   protected todos = inject(TODOS)
   
   @Input()
   userId: string
   
   ngOnChanges() {
      this.todos.fetch(this.userId)
   }
}
```

Read values in template

```html
<!-- todos.component.html -->
<div *ngIf="todos.error">
   Something went wrong
   <button (click)="todos.revalidate()">Retry</button>
</div>
<spinner *ngIf="todos.pending"></spinner>
<todo *ngFor="let todo of todos.value" [value]="todo"></todo>
```

## Options

```ts
export interface ResourceOptions {
   providedIn?: Type<any> | "root" | "platform" | "any" | null
   immutable?: boolean
   timeoutMs?: number
   dedupeMs?: number
   serialize?: (...params: any[]) => string
   features?: ResourceFeatureWithOptions<{}>[]
}
```

| property   | default        | description                                                                                               |
|------------|----------------|-----------------------------------------------------------------------------------------------------------|
| providedIn | null           | Configure which module the resource is provided in                                                        |
| immutable  | false          | Prevent refetching a resource that is already cached with the given params                                |
| timeoutMs  | void           | How long a resource should wait after fetching without receiving a response before it is marked as `slow` |
| dedupeMs   | 2000           | How long a resource should wait before allowing a duplicate fetch with the same params                    |
| serialize  | JSON.stringify | Serializer used to stringify fetch parameters                                                             |
| features   | void           | A list of `ResourceFeatureWithOptions` that add additional behaviours to the resource                     |

## Adding Features

Resource behavior can be customised by adding features.

### `revalidateOnFocus`

Revalidate a resource every time the current page receives window focus.

### `revalidateOnReconnect`

Revalidate a resource every time the network connection comes back online.

### `revalidateOnInterval`

Revalidate a resource periodically according to a timer.

### Writing Custom Features

Create a class that implements the `ResourceFeature` interface.

```ts
interface ResourceFeature<T extends {}> {
   onInit?(resource: Resource, options: T): void
   onConnect?(resource: Resource, options: T): void
   onDisconnect?(resource: Resource, options: T): void
   onDestroy?(resource: Resource, options: T): void
}
```

Example

```ts
import { createFeature, Fetchable, Resource, ResourceFeature } from "@mmuscat/angular-swr"

interface LoggerOptions {
   logger?: typeof console
}

@Injectable({ providedIn: "root" })
export class Logger implements ResourceFeature<LoggerOptions> {
   onInit(resource: Resource<T>, { logger = console }: LoggerOptions) {
      resource.subscribe(() => {
         logger.log(resource.value)
      })
   }
}

export function logger(options: LoggerOptions = {}) {
   return createFeature(Logger, options)
}
```
