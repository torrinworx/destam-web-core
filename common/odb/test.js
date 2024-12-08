import { OObject } from "destam-dom";
import { ODB, initODB } from "./index.js";

const main = async () => {
    await initODB();
    let testdb;

    testdb = await ODB('mongodb', 'test', { email: 'bob@example.com'});
    if (!testdb) {
        testdb = await ODB('mongodb', 'test', {}, OObject({
            email: 'bob@example.com',
            age: 1
        }));
    }

    testdb.age = testdb.age + 1
    console.log(testdb);
};

main();
