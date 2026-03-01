import 'axios';

declare module 'axios' {
  export interface AxiosRequestConfig {
    metadata?: {
      startTime?: number;
      [key: string]: any;
    };
  }
  
  export interface InternalAxiosRequestConfig {
    metadata?: {
      startTime?: number;
      [key: string]: any;
    };
  }
}