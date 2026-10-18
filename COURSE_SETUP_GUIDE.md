# How to Create and Edit a Course

Practical companion to `TECHNICAL_REFERENCE_V2.md` §5. Read this when a course
isn't showing up somewhere it should.

---

## 0. One-time: re-seed the database

**You must do this before anything else works.** The old seed data had a broken
teacher record, and there was no batch at all - which is why the teacher and
student pages were blank.

```
node seed.js
```

Then restart the server (`node server.js` or `npm start`).

This wipes and rebuilds: 7 subjects, 4 entry tests, 2 courses, 1 batch, 1
teacher, 1 student. Logins printed at the end of the seed output:

| Role    | Email                  | Password     |
|---------|------------------------|--------------|
| Admin   | admin@mindroute.pk     | admin1234    |
| Teacher | teacher@mindroute.pk   | teacher1234  |
| Student | student@mindroute.pk   | student1234  |

Change these before any real deployment.

After seeding you should immediately see: 2 courses in the admin Courses page,
2 courses on the teacher's Courses page, and 2 courses on the student's Courses
page. If any of those is empty, jump to the troubleshooting table at the bottom.

---

## 1. Create a course (Admin)

1. Log in as admin. You now land on **Admin/dashboard.html**. (Previously admin
   login landed on `Admin/index.html`, a retired page whose menu had no Courses
   entry - that's why there seemed to be no way to create a course.)
2. Click **Courses** in the left sidebar.
3. Click **Add Course** in the top bar.
4. Fill in the form:
   - **Title** - free text, e.g. "MDCAT Physics Intensive".
   - **Subject** - pick from the dropdown. This is the single most important
     field; see the warning below.
   - **Teacher** - who will build and own the curriculum. The dropdown shows
     each teacher's subjects in brackets so you can avoid assigning a teacher
     to a subject they don't teach. Can be left unassigned for now.
   - **Icon** - one character, shown on the course card. Defaults to the first
     letter of the subject.
   - **Colour** - one of five presets; the light tint is derived automatically.
   - **Description** - one or two lines, shown on the card.
5. **Save Course.**

### The Subject field decides whether anyone can see the course

A course only reaches students whose **entry test requires that subject**. So if
you create a Physics course but no entry test lists "Physics", the course exists
and is completely invisible to every student.

The admin Courses page flags this for you: any course whose subject isn't
required by at least one entry test gets a red **"No entry test requires this
subject"** warning on its card, and is counted in the **Unreachable Subject**
stat at the top. If you see that, either fix the course's subject or add the
subject to an entry test under **Admin → Entry Tests**.

Subject matching is **exact and case-sensitive**. `physics` will not match
`Physics`.

---

## 2. Edit a course

**Admin edits the shell.** On the Courses page, click **Edit** on any course
card. You can change the title, subject, teacher, icon, colour and description.

Admin editing deliberately **cannot touch weeks or topics** - the save payload
omits the `weeks` field entirely, so an admin rename can never wipe the
teacher's curriculum.

**The teacher builds the content.** The assigned teacher logs in, opens their
**Courses** page, and adds weeks → topics → contents (video / notes / quiz /
assignment) there. That's the existing teacher course editor; nothing about it
changed.

**Delete** is available both on the card and inside the edit modal. If any
students are enrolled, the confirmation tells you how many before you commit.

---

## 3. Why a course appears (or doesn't)

Every visibility bug in this project traces back to one chain. Each arrow has to
hold:

```
Subject exists
   ↓  (by exact name)
EntryTest lists it in subjects[]
   ↓
Course exists with that subject
   ↓
Batch points at that EntryTest (entryTestId)
   and maps subject → teacher (subjectTeachers)
   ↓
Student is in that Batch's studentIds
   ↓
Student.enrolledCourseIds gets the course
   ↓
Student sees it · Teacher sees it
```

Enrollment happens automatically in `routes/batches.js` via
`enrollStudentsInBatchCourses()` - on batch **create** and, as of this fix, on
batch **edit** too. Previously, adding a student to an existing batch never
enrolled them in anything.

A teacher's course list is resolved by `getTeacherCourseIds()` in `app.js`, which
looks through every batch's `subjectTeachers` map for that teacher's id, plus any
ids in their own `courseIds`.

### If you create a course *after* students already exist

The course won't retroactively appear for them. Open **Admin → Batches**, edit
the relevant batch, and save it - that re-runs enrollment and picks up the new
course.

---

## 4. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Admin Courses page is empty | No courses in DB | Click **Add Course**, or run `node seed.js` |
| Course card shows a red "no entry test requires this subject" warning | Subject isn't in any `EntryTest.subjects[]` | Change the course subject, or add it under Admin → Entry Tests |
| Course card says "Curriculum is empty" | Nobody's built content yet | Assigned teacher adds weeks/topics from their Courses page |
| Teacher's Courses page is empty | Teacher has no `subjects`, or no batch maps their id in `subjectTeachers` | Check the teacher record has `subjects` (plural!); assign them to a subject in Admin → Batches |
| Student's Courses page says "not enrolled in any courses" | Student isn't in a batch, or their batch's entry test doesn't require the course subject | Add them to a batch in Admin → Batches and save |
| Student sees a course but the button says "No content yet" | Course has zero topics | Teacher needs to add content |

### The `subjects` vs `subject` trap

`models/Teacher.js` defines the field as **`subjects`** (plural, an array).
Writing `subject:` instead means Mongoose **silently discards it** - no error, no
warning. The teacher ends up with no subjects, no batch can meaningfully assign
them, and their Courses page renders empty. That exact one-character typo in
`seed.js` was the original bug behind "for teacher there is no course."

Whenever a field seems to vanish, check the spelling against the model file
before debugging anything else.
