// OFile(). An observer that works in tandum with ODB to automatically store files in an ODB, while keeping the observer
// state tree clean by only referencing an id.
// OFile should basically act just like a normal observerl. Throw in some kind of checksum of the file that can be watched
// for updates or something on the file system.

/*
The goal of this is to store files outside a database since they are data intensive and databases are not generally suitable
for file storage.

Instead, in the db we will store references to files, called OFiles that operate similarly to Observers
in that they can be watched for changes.
*/

// import { ODB } from ".";

const OFiles = () => {

    
};

export default OFiles;
