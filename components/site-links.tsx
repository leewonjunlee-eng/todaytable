'use client';
import {createContext,useContext} from 'react';
const SiteLinksContext=createContext({participant:'/',operator:''});
export const SiteLinksProvider=SiteLinksContext.Provider;
export const useSiteLinks=()=>useContext(SiteLinksContext);
