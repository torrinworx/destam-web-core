import { OObject } from "destam-dom";
import { ODB, initODB } from "./index.js";

const main = async () => {
    await initODB();

    const someDB = await ODB('mongodb', 'some', {}, OObject({
        nameFirst: 'bob',
        nameLast: 'user',
        age: 50,
        email: 'bob@example.com'
    }));

    someDB.age = 51

    console.log(someDB);
};

main();
