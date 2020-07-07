import { Injectable } from '@angular/core';
import { Options } from '../models/options';
import { Observable, iif, of, forkJoin } from 'rxjs';
import { CloudAppRestService, Request } from '@exlibris/exl-cloudapp-angular-lib';
import { tap, switchMap, map, concatMap } from 'rxjs/operators';
import _ from 'lodash';
import { CodeTable, Licenses, IntegrationProfiles } from '../models/alma';

@Injectable()
export class OptionsService {
  private codes = [
    'IsFree',
    'BooleanYesNoNumericCode',
    'CollectionAccessType',
    'CounterPlatform',
    'BooleanYesNo'
  ]
  private _options: Options;

  constructor(
    private restService: CloudAppRestService
  ) { }

  get options(): Observable<Options> {
    return iif(
      ()=>this._options!=undefined, 
      of(this._options),
      forkJoin(
        /* Code tables */
        this.codes.map(key=>this.restService.call<CodeTable>(`/conf/code-tables/${key}`))
      )
      .pipe(
        tap(results=> {
          this._options = new Options();
          results.forEach(table => 
            this._options[_.camelCase(table.name)] = 
              table.row.map(r=>({code: r.code, desc: r.description}))
              .sort(sort('desc'))
          )
        }),
        /* Other APIs */
        switchMap(()=>forkJoin([
          this.getAll<IntegrationProfiles>('/conf/integration-profiles?type=PROXY_DEFINITION'),
          this.getAll<Licenses>('/acq/licenses')
        ])),
        tap(results=>{
          this._options.proxies = 
            results[0].integration_profile.map(p=>({code: p.code, desc: p.code.concat(p.description ? ` (${p.description})` : '')}))
            .sort(sort('desc'));
          this._options.licenses = 
            results[1].license.map(l=>({code: l.code, desc: l.name}))
            .sort(sort('desc'));
        }),
        map(()=>this._options)
      )
    )
  }

  /** Use Alma default parameters to retrieve all items in pages */
  getAll<T=any>( request: string | Request, 
    options: { arrayName: string; chunkSize: number } = { arrayName: null, chunkSize: 50}) 
    {
    let { arrayName, chunkSize } = options;
    let array: Array<any>, count: number;
    let req: Request = typeof request == 'string' ? { url: request } : request;
    if (!req.queryParams) req.queryParams = {};
    req.queryParams['limit'] = chunkSize;
    return this.restService.call(req).pipe(
      tap(results => {
        arrayName = arrayName || Object.keys(results).find(k=>Array.isArray(results[k]));
        array = results[arrayName];
        count = results.total_record_count || 0;
      }),
      switchMap(results => iif(
        ()=>!(arrayName && Array.isArray(results[arrayName]) && count > results[arrayName].length),
        of(results as T),
        forkJoin(
          arrayOf(Math.ceil(count/chunkSize)-1)
          .map(i=>{
            const newReq = _.cloneDeep(req);
            newReq.queryParams.offset = (i+1)*chunkSize;
            return this.restService.call(newReq);
          })
        )
        .pipe(
          map(results=>{
            for (const result of results) {
              array = array.concat(result[arrayName]);
            }
            return Object.assign(results[0], Object.assign(results[0], {[arrayName]: array})) as T
;          })
        )
      ))
    )
  }
}

const sort = (field: string) => ( a: any, b: any ) => {
  if ( a[field] < b[field] ) return -1;
  if ( a[field] > b[field] ) return 1;
  return 0;
}

const arrayOf = (length: number) => Array.from({length: length}, (v, i) => i);