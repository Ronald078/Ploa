import {createContext,useContext} from 'react';
export const OperatorContext=createContext('Ronald');
export const useOperatorName=()=>useContext(OperatorContext);
