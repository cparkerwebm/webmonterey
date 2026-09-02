import { webmontereyCollections } from '@cparkerwebm/webmonterey/content';
import { schema as content000001 } from './components/content/content-000001/schema.ts';
import { schema as region000001 } from './components/regions/region-000001/schema.ts';

/*
 * The block union is what makes a typo in page JSON a BUILD ERROR rather than a blank space.
 * Adding a component means three things: the folder, the registry, and this union.
 */
export const collections = webmontereyCollections([content000001, region000001]);
