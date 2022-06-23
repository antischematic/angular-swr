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
import { createResource, RevalidateOnFocus, RevalidateOnReconnect } from "@mmuscat/angular-swr"

export const TODOS = createResource(Fetcher, {
   features: [RevalidateOnFocus, RevalidateOnReconnect]
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
   dedupeIntervalMs?: number
   serialize?: (...params: any[]) => string
   features?: Type<ResourceFeature<any>>[]
}
```

| property         | default        | description                                                                                               |
|------------------|----------------|-----------------------------------------------------------------------------------------------------------|
| providedIn       | null           | Configure which module the resource is provided in                                                        |
| immutable        | false          | Prevent refetching a resource that is already cached with the given params                                |
| timeoutMs        | void           | How long a resource should wait after fetching without receiving a response before it is marked as `slow` |
| dedupeIntervalMs | 2000           | After fetching, discard additional fetches for same params within the configured time period              |
| serialize        | JSON.stringify | Serializer used to stringify fetch parameters                                                             |
| features         | void           | A list of types implementing `ResourceFeature` that add additional behaviours to the resource             |

## Adding Features

Resource behavior can be customised by adding features.

### `RevalidateOnFocus`

Revalidate a resource every time the current page receives window focus.

### `RevalidateOnReconnect`

Revalidate a resource every whenever the network connection comes back online.

### Writing Custom Features

Create a class that implements the `ResourceFeature` interface.

```ts
interface ResourceFeature<T extends Fetchable> {
   onInit?(resource: Resource<T>): void
   onConnect?(resource: Resource<T>): void
   onDisconnect?(resource: Resource<T>): void
   onDestroy?(resource: Resource<T>): void
}
```

Example

```ts
import { ResourceFeature, Fetchable } from "@mmuscat/angular-swr"
import { Resource } from "./resource"

@Injectable({ providedIn: "root" })
export class LoggerFeature<T extends Fetchable> implements ResourceFeature<T> {
   next(resource: Resource<T>) {
      console.log(resource.value)
   }

   onInit(resource: Resource<T>) {
      resource.subscribe(this)
   }
}
```
