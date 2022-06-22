# Angular SWR

Data fetching for Angular 14+

## Usage

Create a service that fetches data

```ts
const endpoint = "https://jsonplaceholder.typicode.com/todos"

@Injectable({ providedIn: "root" })
export class Fetcher implements Fetchable<Todo[]> {
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
