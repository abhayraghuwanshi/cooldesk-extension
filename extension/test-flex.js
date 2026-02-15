import FlexSearch from 'flexsearch';
console.log('FlexSearch:', FlexSearch);
console.log('Document:', FlexSearch.Document);
try {
    const { Document } = FlexSearch;
    console.log('Destructured Document:', Document);
} catch (e) {
    console.log('Destructuring failed');
}
